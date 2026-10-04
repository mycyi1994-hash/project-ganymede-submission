// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {FixedPoint128} from "@uniswap/v4-core/src/libraries/FixedPoint128.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

interface IRangeNavFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IRangePoolToken {
    function decimals() external view returns (uint8);
}

/// @title GanymedeRangeLiquidityHook
/// @notice A Uniswap v4 pool for a real-world-asset token against a dollar token in which every
///         liquidity provider holds positions of their own, shaped as Meteora shapes them: a run of
///         equal-width bins either side of the pool's price, the dollar token in the bins below it
///         and the asset in the bins above, spread evenly (Spot), heaviest next to the price (Curve)
///         or heaviest at the far ends (Bid-Ask). On X Layer Testnet: USTX against dUSD, priced by
///         GanymedeNavFeed.
///
///         The NAV guards the pool rather than moving it. Positions open only while the pool's price
///         is within OPEN_TICKS of the NAV, so a moved price cannot place someone's bins; swaps need
///         a NAV at most MAX_NAV_AGE old and pay a fee that rises from MIN_FEE at a fresh NAV to
///         MAX_FEE at that age; and no swap may leave the price more than BAND_TICKS from the NAV.
///         Arbitrage through the fund (GanymedeRangeArbitrage) brings the price back to the NAV.
/// @dev Pool: the two tokens sorted by address, a dynamic fee and TICK_SPACING, with this hook, opened
///      at the NAV in the constructor. The pool manager does not call a hook back for its own calls;
///      the hook refuses every other pool and all liquidity it does not add itself. Each position's
///      liquidity sits in the pool manager under this hook with the position's id as its salt, so
///      positions never share fees. Closing pays the position's tokens and fees to its owner at any
///      NAV, stale or missing. No owner, no pause, nothing to configure.
contract GanymedeRangeLiquidityHook is IHooks, IUnlockCallback {
    using StateLibrary for IPoolManager;

    enum Shape {
        Spot,
        Curve,
        BidAsk
    }

    struct Position {
        address owner;
        Shape shape;
        /// @notice The lower tick of the tick-spacing interval the price was in at opening; bins
        ///         below end at it, bins above start one spacing over it.
        int24 center;
        int24 binTicks;
        uint8 binsBelow;
        uint8 binsAbove;
        bool open;
    }

    enum Action {
        Open,
        Close
    }

    int24 public constant TICK_SPACING = 10;
    /// @notice Bins are 10 to 500 ticks wide (0.1% to about 5%), in whole tick spacings.
    int24 public constant MAX_BIN_TICKS = 500;
    /// @notice At most this many bins on each side.
    uint8 public constant MAX_BINS = 20;
    /// @notice Positions open only with the price at most this many ticks from the NAV (≈ 1%).
    int24 public constant OPEN_TICKS = 100;
    /// @notice No swap may leave the price more than this many ticks from the NAV (≈ 5%).
    int24 public constant BAND_TICKS = 500;
    uint24 public constant MIN_FEE = 3_000;
    uint24 public constant MAX_FEE = 10_000;
    uint256 public constant MAX_NAV_AGE = 1 hours;
    uint256 public constant CLOCK_TOLERANCE = 60;

    IPoolManager public immutable poolManager;
    IRangeNavFeed public immutable navFeed;
    address public immutable asset;
    address public immutable dollar;
    Currency public immutable currency0;
    Currency public immutable currency1;
    bool public immutable assetIsCurrency0;
    PoolId public immutable poolId;
    uint256 private immutable navUnit;
    uint256 private immutable dollarUnit;

    uint256 public nextPositionId = 1;
    mapping(uint256 => Position) public positions;
    mapping(uint256 => uint128[]) private _liquidity;
    mapping(address => uint256[]) private _positionsOf;
    uint256 private _locked = 1;

    event PositionOpened(
        uint256 indexed id,
        address indexed owner,
        Shape shape,
        int24 center,
        int24 binTicks,
        uint8 binsBelow,
        uint8 binsAbove,
        uint256 amount0,
        uint256 amount1
    );
    event PositionClosed(uint256 indexed id, address indexed owner, uint256 amount0, uint256 amount1);

    error NotPoolManager();
    error HookNotImplemented();
    error PoolOpenedByHook();
    error LiquidityThroughHook();
    error InvalidAddress();
    error InvalidToken();
    error InvalidShape();
    error InvalidAmount();
    error NotOwner();
    error PositionClosedAlready();
    error Expired();
    error SlippageExceeded();
    error PriceAwayFromNav(int24 tick, int24 navTick);
    error NavUnavailable();
    error NavTooOld(uint256 updatedAt);
    error NavInFuture(uint256 updatedAt);
    error NavOutOfRange();
    error OutsideBand(int24 tick, int24 navTick);
    error TransferFailed();
    error Reentrancy();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    /// @dev Deploy at an address whose low bits carry exactly these permissions (a CREATE2 salt).
    constructor(address manager, address assetToken, address dollarToken, address feed) {
        if (manager == address(0) || feed == address(0)) revert InvalidAddress();
        if (assetToken == address(0) || dollarToken == address(0) || assetToken == dollarToken) revert InvalidAddress();
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: true,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
        uint256 dollarDecimals = IRangePoolToken(dollarToken).decimals();
        uint256 priceDecimals = uint256(IRangeNavFeed(feed).decimals()) + IRangePoolToken(assetToken).decimals();
        if (dollarDecimals < 6 || dollarDecimals > 18 || priceDecimals > 36) revert InvalidToken();

        poolManager = IPoolManager(manager);
        navFeed = IRangeNavFeed(feed);
        asset = assetToken;
        dollar = dollarToken;
        bool assetFirst = assetToken < dollarToken;
        assetIsCurrency0 = assetFirst;
        currency0 = Currency.wrap(assetFirst ? assetToken : dollarToken);
        currency1 = Currency.wrap(assetFirst ? dollarToken : assetToken);
        dollarUnit = 10 ** dollarDecimals;
        navUnit = 10 ** priceDecimals;

        PoolKey memory key = poolKey();
        poolId = key.toId();
        (uint160 sqrtPriceX96, , ) = _nav();
        poolManager.initialize(key, sqrtPriceX96);
    }

    // ---- Liquidity providers ----

    /// @notice Opens a position for the caller: `binsBelow` bins of `binTicks` ticks below the
    ///         price, funded with up to `amount1` of currency1, and `binsAbove` above it, funded with
    ///         up to `amount0` of currency0 (both approved to this contract), each side spread by
    ///         `shape`. The interval the price is in is left out, so every bin holds one token. Needs
    ///         a NAV at most MAX_NAV_AGE old and the price within OPEN_TICKS of it. Takes only what
    ///         the bins use, which is at most the amounts given; PositionOpened records it.
    function open(Shape shape, int24 binTicks, uint8 binsBelow, uint8 binsAbove, uint256 amount0, uint256 amount1, uint256 deadline)
        external
        nonReentrant
        beforeDeadline(deadline)
        returns (uint256 id)
    {
        _checkShape(binTicks, binsBelow, binsAbove, amount0, amount1);
        Position memory position = Position(msg.sender, shape, 0, binTicks, binsBelow, binsAbove, true);
        id = abi.decode(poolManager.unlock(abi.encode(Action.Open, abi.encode(position, amount0, amount1))), (uint256));
    }

    function _checkShape(int24 binTicks, uint8 binsBelow, uint8 binsAbove, uint256 amount0, uint256 amount1) private pure {
        if (binTicks < TICK_SPACING || binTicks > MAX_BIN_TICKS || binTicks % TICK_SPACING != 0) revert InvalidShape();
        if (binsBelow > MAX_BINS || binsAbove > MAX_BINS || (binsBelow == 0 && binsAbove == 0)) revert InvalidShape();
        if ((binsBelow > 0) != (amount1 > 0) || (binsAbove > 0) != (amount0 > 0)) revert InvalidAmount();
    }

    /// @notice Closes the caller's position `id`: removes every bin's liquidity and pays its tokens and
    ///         fees to the caller, at any NAV.
    function close(uint256 id, uint256 amount0Min, uint256 amount1Min, uint256 deadline)
        external
        nonReentrant
        beforeDeadline(deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        Position memory position = positions[id];
        if (position.owner != msg.sender) revert NotOwner();
        if (!position.open) revert PositionClosedAlready();
        (amount0, amount1) = abi.decode(poolManager.unlock(abi.encode(Action.Close, abi.encode(id))), (uint256, uint256));
        if (amount0 < amount0Min || amount1 < amount1Min) revert SlippageExceeded();
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (Action action, bytes memory body) = abi.decode(data, (Action, bytes));
        if (action == Action.Open) return _open(body);
        uint256 id = abi.decode(body, (uint256));
        (uint256 amount0, uint256 amount1) = _close(id);
        return abi.encode(amount0, amount1);
    }

    // ---- Hook callbacks ----

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert PoolOpenedByHook();
    }

    /// @dev Only the hook adds liquidity, and the pool manager does not call it back for its own calls.
    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert LiquidityThroughHook();
    }

    /// @dev Needs a NAV at most MAX_NAV_AGE old and sets the fee for its age.
    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        (, uint256 updatedAt, ) = _nav();
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, _fee(updatedAt) | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @dev No swap may leave the price more than BAND_TICKS from the NAV.
    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, int128)
    {
        (, int24 tick, , ) = poolManager.getSlot0(poolId);
        (uint160 navSqrt, , ) = _nav();
        int24 navTick = TickMath.getTickAtSqrtPrice(navSqrt);
        if (tick > navTick + BAND_TICKS || tick < navTick - BAND_TICKS) revert OutsideBand(tick, navTick);
        return (IHooks.afterSwap.selector, 0);
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    // ---- Views ----

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    /// @notice The NAV swaps use now and the pool price it maps to. Reverts when the NAV is missing
    ///         or older than MAX_NAV_AGE.
    function nav() external view returns (uint256 answer, uint256 updatedAt, uint160 sqrtPriceX96) {
        (sqrtPriceX96, updatedAt, answer) = _nav();
    }

    /// @notice The fee a swap pays now, in hundredths of a basis point. Reverts like `nav()`.
    function currentFee() external view returns (uint24) {
        (, uint256 updatedAt, ) = _nav();
        return _fee(updatedAt);
    }

    /// @notice Every position `account` has opened, open or closed, oldest first.
    function positionsOf(address account) external view returns (uint256[] memory) {
        return _positionsOf[account];
    }

    /// @notice A position's bins, lowest first: each one's lower and upper tick and liquidity.
    function binsOf(uint256 id) external view returns (int24[] memory lowers, int24[] memory uppers, uint128[] memory liquidity) {
        Position memory position = positions[id];
        uint256 count = uint256(position.binsBelow) + position.binsAbove;
        lowers = new int24[](count);
        uppers = new int24[](count);
        liquidity = _liquidity[id];
        for (uint256 index = 0; index < count; index++) (lowers[index], uppers[index]) = _bin(position, index);
    }

    /// @notice What closing `id` would pay now: its tokens at the pool's price and their uncollected
    ///         fees, rounded down. Zero once closed.
    function positionAmounts(uint256 id) external view returns (uint256 amount0, uint256 amount1, uint256 fees0, uint256 fees1) {
        Position memory position = positions[id];
        if (!position.open) return (0, 0, 0, 0);
        uint128[] memory liquidity = _liquidity[id];
        for (uint256 index = 0; index < liquidity.length; index++) {
            (uint256 a0, uint256 a1, uint256 f0, uint256 f1) = _binAmounts(position, index, liquidity[index], bytes32(id));
            amount0 += a0 + f0;
            amount1 += a1 + f1;
            fees0 += f0;
            fees1 += f1;
        }
    }

    /// @dev One bin's tokens at the pool's price and its uncollected fees.
    function _binAmounts(Position memory position, uint256 index, uint128 liquidity, bytes32 salt)
        private
        view
        returns (uint256 amount0, uint256 amount1, uint256 fees0, uint256 fees1)
    {
        (uint160 sqrtPriceX96, int24 tick, , ) = poolManager.getSlot0(poolId);
        (int24 lower, int24 upper) = _bin(position, index);
        (amount0, amount1) = _amountsFor(lower, upper, liquidity, sqrtPriceX96, tick);
        (fees0, fees1) = _pendingFees(lower, upper, liquidity, salt);
    }

    // ---- Inside the pool manager's unlock ----

    function _open(bytes memory body) private returns (bytes memory) {
        (Position memory position, uint256 amount0, uint256 amount1) = abi.decode(body, (Position, uint256, uint256));
        position.center = _openingCenter(position);
        uint256 id = nextPositionId++;
        positions[id] = position;
        _positionsOf[position.owner].push(id);
        (uint256 owed0, uint256 owed1) = _addBins(id, position, amount0, amount1);
        if (owed0 == 0 && owed1 == 0) revert InvalidAmount();
        _receive(currency0, position.owner, owed0);
        _receive(currency1, position.owner, owed1);
        emit PositionOpened(id, position.owner, position.shape, position.center, position.binTicks, position.binsBelow, position.binsAbove, owed0, owed1);
        return abi.encode(id);
    }

    /// @dev The interval the price is in, which must be within OPEN_TICKS of a fresh NAV, with room
    ///      for the bins on both sides.
    function _openingCenter(Position memory position) private view returns (int24 center) {
        (uint160 navSqrt, , ) = _nav();
        (, int24 tick, , ) = poolManager.getSlot0(poolId);
        int24 navTick = TickMath.getTickAtSqrtPrice(navSqrt);
        if (tick > navTick + OPEN_TICKS || tick < navTick - OPEN_TICKS) revert PriceAwayFromNav(tick, navTick);
        center = _floor(tick);
        if (
            center - int24(uint24(position.binsBelow)) * position.binTicks < TickMath.MIN_TICK
                || center + TICK_SPACING + int24(uint24(position.binsAbove)) * position.binTicks > TickMath.MAX_TICK
        ) revert InvalidShape();
    }

    /// @dev Adds every bin of a new position, each side spread by its shape, and returns what it owes.
    function _addBins(uint256 id, Position memory position, uint256 amount0, uint256 amount1) private returns (uint256 owed0, uint256 owed1) {
        uint256 total = uint256(position.binsBelow) + position.binsAbove;
        for (uint256 index = 0; index < total; index++) {
            (uint256 bin0, uint256 bin1) = _addBin(id, position, index, amount0, amount1);
            owed0 += bin0;
            owed1 += bin1;
        }
    }

    function _addBin(uint256 id, Position memory position, uint256 index, uint256 amount0, uint256 amount1) private returns (uint256 owed0, uint256 owed1) {
        (int24 lower, int24 upper) = _bin(position, index);
        uint128 amount = _binLiquidity(position, index, lower, upper, index < position.binsBelow ? amount1 : amount0);
        _liquidity[id].push(amount);
        if (amount == 0) return (0, 0);
        (BalanceDelta delta, ) = poolManager.modifyLiquidity(poolKey(), ModifyLiquidityParams(lower, upper, int256(uint256(amount)), bytes32(id)), "");
        return (uint256(uint128(-delta.amount0())), uint256(uint128(-delta.amount1())));
    }

    /// @dev A bin's liquidity for its side's `amount`: its share by the shape's weight, currency1
    ///      below the price and currency0 above it. Distance 1 is the bin next to the price.
    function _binLiquidity(Position memory position, uint256 index, int24 lower, int24 upper, uint256 amount) private pure returns (uint128) {
        bool below = index < position.binsBelow;
        uint256 count = below ? position.binsBelow : position.binsAbove;
        uint256 distance = below ? position.binsBelow - index : index - position.binsBelow + 1;
        uint256 part = FullMath.mulDiv(amount, _weight(position.shape, distance, count), _weights(position.shape, count));
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(upper);
        return below ? _liquidityForAmount1(sqrtLower, sqrtUpper, part) : _liquidityForAmount0(sqrtLower, sqrtUpper, part);
    }

    function _close(uint256 id) private returns (uint256 amount0, uint256 amount1) {
        Position memory position = positions[id];
        positions[id].open = false;
        uint128[] memory liquidity = _liquidity[id];
        PoolKey memory key = poolKey();
        for (uint256 index = 0; index < liquidity.length; index++) {
            if (liquidity[index] == 0) continue;
            (int24 lower, int24 upper) = _bin(position, index);
            (BalanceDelta delta, ) =
                poolManager.modifyLiquidity(key, ModifyLiquidityParams(lower, upper, -int256(uint256(liquidity[index])), bytes32(id)), "");
            amount0 += uint256(uint128(delta.amount0()));
            amount1 += uint256(uint128(delta.amount1()));
        }
        if (amount0 > 0) poolManager.take(currency0, position.owner, amount0);
        if (amount1 > 0) poolManager.take(currency1, position.owner, amount1);
        emit PositionClosed(id, position.owner, amount0, amount1);
    }

    /// @dev Bin `index` of a position, lowest first: the bins below end at `center`; the bins above
    ///      start one tick spacing over it, past the interval the price was in.
    function _bin(Position memory position, uint256 index) private pure returns (int24 lower, int24 upper) {
        if (index < position.binsBelow) {
            int24 steps = int24(uint24(position.binsBelow - index));
            lower = position.center - steps * position.binTicks;
            upper = lower + position.binTicks;
        } else {
            int24 steps = int24(uint24(index - position.binsBelow));
            lower = position.center + TICK_SPACING + steps * position.binTicks;
            upper = lower + position.binTicks;
        }
    }

    /// @dev A bin's weight by its distance from the price, 1 for the nearest, out of `count`.
    function _weight(Shape shape, uint256 distance, uint256 count) private pure returns (uint256) {
        if (shape == Shape.Spot) return 1;
        if (shape == Shape.Curve) return count + 1 - distance;
        return distance;
    }

    function _weights(Shape shape, uint256 count) private pure returns (uint256) {
        return shape == Shape.Spot ? count : count * (count + 1) / 2;
    }

    function _floor(int24 tick) private pure returns (int24) {
        int24 floored = (tick / TICK_SPACING) * TICK_SPACING;
        return tick < 0 && tick % TICK_SPACING != 0 ? floored - TICK_SPACING : floored;
    }

    /// @dev Pays the pool manager `amount` of `currency` from `payer`, which approved this contract.
    function _receive(Currency currency, address payer, uint256 amount) private {
        if (amount == 0) return;
        poolManager.sync(currency);
        (bool ok, bytes memory result) =
            Currency.unwrap(currency).call(abi.encodeWithSelector(0x23b872dd, payer, address(poolManager), amount)); // transferFrom
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
        poolManager.settle();
    }

    // ---- Pricing ----

    function _nav() private view returns (uint160 sqrtPriceX96, uint256 updatedAt, uint256 answer) {
        (, int256 reported, , uint256 updated, ) = navFeed.latestRoundData();
        if (reported <= 0 || updated == 0) revert NavUnavailable();
        if (updated > block.timestamp + CLOCK_TOLERANCE) revert NavInFuture(updated);
        if (block.timestamp > updated + MAX_NAV_AGE) revert NavTooOld(updated);
        if (uint256(reported) > type(uint128).max) revert NavOutOfRange();
        answer = uint256(reported);
        updatedAt = updated;
        uint256 dollarsPerAsset = answer * dollarUnit;
        (uint256 numerator, uint256 denominator) = assetIsCurrency0 ? (dollarsPerAsset, navUnit) : (navUnit, dollarsPerAsset);
        if (numerator / denominator >= 1 << 64) revert NavOutOfRange();
        uint256 root = _sqrt(FullMath.mulDiv(numerator, 1 << 192, denominator));
        if (root <= TickMath.MIN_SQRT_PRICE) revert NavOutOfRange();
        sqrtPriceX96 = uint160(root);
    }

    function _fee(uint256 updatedAt) private view returns (uint24) {
        uint256 age = block.timestamp > updatedAt ? block.timestamp - updatedAt : 0;
        return uint24(MIN_FEE + (uint256(MAX_FEE - MIN_FEE) * age) / MAX_NAV_AGE);
    }

    function _amountsFor(int24 lower, int24 upper, uint128 liquidity, uint160 sqrtPriceX96, int24 tick)
        private
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (liquidity == 0) return (0, 0);
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(upper);
        if (tick < lower) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, liquidity, false);
        } else if (tick < upper) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtUpper, liquidity, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtPriceX96, liquidity, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, liquidity, false);
        }
    }

    function _pendingFees(int24 lower, int24 upper, uint128 liquidity, bytes32 salt) private view returns (uint256 fees0, uint256 fees1) {
        if (liquidity == 0) return (0, 0);
        (uint256 inside0, uint256 inside1) = poolManager.getFeeGrowthInside(poolId, lower, upper);
        bytes32 positionKey = keccak256(abi.encodePacked(address(this), lower, upper, salt));
        (, uint256 last0, uint256 last1) = poolManager.getPositionInfo(poolId, positionKey);
        unchecked {
            fees0 = FullMath.mulDiv(inside0 - last0, liquidity, FixedPoint128.Q128);
            fees1 = FullMath.mulDiv(inside1 - last1, liquidity, FixedPoint128.Q128);
        }
    }

    // Uniswap's LiquidityAmounts for one token, rounded down: adding the result never needs more
    // than the amount given.
    function _liquidityForAmount0(uint160 sqrtLower, uint160 sqrtUpper, uint256 amount0) private pure returns (uint128) {
        uint256 intermediate = FullMath.mulDiv(sqrtLower, sqrtUpper, FixedPoint96.Q96);
        return _toUint128(FullMath.mulDiv(amount0, intermediate, sqrtUpper - sqrtLower));
    }

    function _liquidityForAmount1(uint160 sqrtLower, uint160 sqrtUpper, uint256 amount1) private pure returns (uint128) {
        return _toUint128(FullMath.mulDiv(amount1, FixedPoint96.Q96, sqrtUpper - sqrtLower));
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert InvalidAmount();
        return uint128(value);
    }

    /// @dev Floor of the square root, as OpenZeppelin's Math.sqrt.
    function _sqrt(uint256 x) private pure returns (uint256) {
        if (x == 0) return 0;
        uint256 xx = x;
        uint256 r = 1;
        if (xx >= 0x100000000000000000000000000000000) {
            xx >>= 128;
            r <<= 64;
        }
        if (xx >= 0x10000000000000000) {
            xx >>= 64;
            r <<= 32;
        }
        if (xx >= 0x100000000) {
            xx >>= 32;
            r <<= 16;
        }
        if (xx >= 0x10000) {
            xx >>= 16;
            r <<= 8;
        }
        if (xx >= 0x100) {
            xx >>= 8;
            r <<= 4;
        }
        if (xx >= 0x10) {
            xx >>= 4;
            r <<= 2;
        }
        if (xx >= 0x8) r <<= 1;
        for (uint256 i = 0; i < 7; i++) r = (r + x / r) >> 1;
        uint256 r1 = x / r;
        return r < r1 ? r : r1;
    }
}
