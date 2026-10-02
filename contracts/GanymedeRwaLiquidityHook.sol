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

interface IRwaNavFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IRwaPoolToken {
    function decimals() external view returns (uint8);
}

/// @title GanymedeRwaLiquidityHook
/// @notice A Uniswap v4 pool for a real-world-asset token against a dollar token, run around the
///         asset's NAV, and the vault of the liquidity providers who fund it: on X Layer Testnet,
///         USTX against dUSD, priced by GanymedeNavFeed. The hook owns all of the pool's liquidity
///         and issues ERC-20 shares for it. Liquidity providers deposit both tokens at the ratio the
///         hook holds them and withdraw their share of everything it holds, fees included. Deposits
///         are priced forward, like a fund's subscriptions: each one waits for the first NAV record
///         published after it and becomes shares there, valued with the holdings at that NAV, so it
///         earns nothing from trades made before its liquidity is in the pool.
///
///         At every new NAV record the hook takes its liquidity out, moves the empty pool to the NAV
///         and puts the liquidity back around it: a base range BASE_TICKS either side of the NAV, as
///         large as the holdings allow, and whatever the base range cannot use as a one-sided range
///         LIMIT_TICKS wide next to the NAV, on the side where that token sells. Moving an empty pool
///         exchanges nothing, so the pool's price follows the NAV without arbitrageurs trading
///         against the liquidity providers at the old price. Between records the pool trades on
///         Uniswap's concentrated-liquidity curve with a fee that rises from MIN_FEE at a fresh NAV
///         to MAX_FEE at MAX_NAV_AGE; past that age swaps stop until a new record arrives, and no
///         swap may leave the price more than BAND_TICKS from the NAV.
/// @dev Pool: the two tokens sorted by address, a dynamic fee and TICK_SPACING, with this hook. It is
///      opened at the NAV in the constructor; the pool manager does not call a hook back for its
///      own calls, and the hook refuses every other pool and all liquidity it does not add itself.
///      The first deposit mints its value at the NAV in dollar units and locks MINIMUM_SHARES.
///      Later deposits take each token in proportion to the holdings, wait as ERC-6909 claims in the
///      pool manager, and at the next re-peg mint shares for their value against the holdings' value
///      at that NAV, rounded down; each depositor then claims their part, and can cancel before.
///      Withdrawals receive the shares' part of everything held, rounded down. Tokens sent to the
///      hook outside a deposit are ignored. Standard ERC-20 tokens only: a token that delivers less
///      than it is asked to send leaves the pool manager unsettled and the call reverts. No owner,
///      no pause, nothing to configure.
contract GanymedeRwaLiquidityHook is IHooks, IUnlockCallback {
    using StateLibrary for IPoolManager;

    struct Range {
        int24 lower;
        int24 upper;
        uint128 liquidity;
    }

    /// @notice A deposit waiting for the re-peg that ends `epoch`.
    struct Pending {
        uint128 amount0;
        uint128 amount1;
        uint64 epoch;
    }

    /// @notice How an epoch's deposits became shares: their total value at the NAV `answer`, and
    ///         the shares minted for it, which the depositors claim in proportion to their value.
    struct Conversion {
        uint128 answer;
        uint128 value;
        uint256 shares;
    }

    enum Action {
        Deposit,
        Cancel,
        Withdraw,
        Repeg
    }

    int24 public constant TICK_SPACING = 10;
    /// @notice Ticks of the base range on each side of the NAV's tick-spacing interval (1.0001^200 ≈ 2%).
    int24 public constant BASE_TICKS = 200;
    /// @notice Width of the one-sided range for what the base range cannot use (≈ 3%).
    int24 public constant LIMIT_TICKS = 300;
    /// @notice No swap may leave the price more than this many ticks from the NAV's interval (≈ 5%).
    int24 public constant BAND_TICKS = 500;
    /// @notice The swap fee at a fresh NAV and at MAX_NAV_AGE, in hundredths of a basis point.
    uint24 public constant MIN_FEE = 3_000;
    uint24 public constant MAX_FEE = 10_000;
    uint256 public constant MAX_NAV_AGE = 1 hours;
    /// @notice How far past its block a record's time may run, as Ganymede's evidence checks allow
    ///         for clocks; such a record counts as fresh.
    uint256 public constant CLOCK_TOLERANCE = 60;
    /// @notice Shares locked for good by the first deposit.
    uint256 public constant MINIMUM_SHARES = 1_000;

    bytes32 private constant BASE_SALT = bytes32(0);
    bytes32 private constant LIMIT_SALT = bytes32(uint256(1));

    IPoolManager public immutable poolManager;
    IRwaNavFeed public immutable navFeed;
    address public immutable asset;
    address public immutable dollar;
    Currency public immutable currency0;
    Currency public immutable currency1;
    bool public immutable assetIsCurrency0;
    PoolId public immutable poolId;
    uint8 public immutable decimals;
    /// @notice The smallest first deposit, $10 in dollar-token units.
    uint256 public immutable minFirstDeposit;
    // 10^(feed decimals + asset decimals) and 10^(dollar decimals): the feed's answer times
    // dollarUnit / navUnit is the price of one base unit of the asset in dollar-token base units.
    uint256 private immutable navUnit;
    uint256 private immutable dollarUnit;

    string public name;
    string public symbol;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    Range public baseRange;
    Range public limitRange;
    /// @notice ERC-6909 claims held for liquidity providers outside the ranges, per currency.
    uint256 public idle0;
    uint256 public idle1;
    /// @notice The `updatedAt` of the NAV record the ranges are centred on.
    uint256 public peggedAt;
    uint160 public bandLowerSqrtPriceX96;
    uint160 public bandUpperSqrtPriceX96;
    /// @notice The number of re-pegs so far. Deposits made in an epoch become shares at the re-peg
    ///         that ends it.
    uint256 public epoch;
    /// @notice Deposits waiting for the next re-peg, per currency; part of the idle claims but not of
    ///         the holdings the shares own.
    uint256 public pending0;
    uint256 public pending1;
    mapping(address => Pending) public pendingOf;
    mapping(uint256 => Conversion) public conversions;
    uint256 private _locked = 1;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposited(address indexed account, uint256 indexed epoch, uint256 amount0, uint256 amount1);
    event DepositCancelled(address indexed account, uint256 indexed epoch, uint256 amount0, uint256 amount1);
    event Converted(uint256 indexed epoch, uint256 navAnswer, uint256 value, uint256 shares);
    event SharesClaimed(address indexed account, uint256 indexed epoch, uint256 shares);
    event Withdrawn(address indexed account, uint256 shares, uint256 amount0, uint256 amount1);
    event Repegged(
        uint256 indexed navUpdatedAt,
        uint256 navAnswer,
        uint160 sqrtPriceX96,
        int24 baseLower,
        int24 baseUpper,
        uint128 baseLiquidity,
        int24 limitLower,
        int24 limitUpper,
        uint128 limitLiquidity
    );

    error NotPoolManager();
    error HookNotImplemented();
    error PoolOpenedByHook();
    error LiquidityThroughHook();
    error InvalidAddress();
    error InvalidToken();
    error InvalidAmount();
    error BelowMinimum();
    error Expired();
    error SlippageExceeded();
    error NoLiquidity();
    error NothingToCancel();
    error NavUnavailable();
    error NavTooOld(uint256 updatedAt);
    error NavInFuture(uint256 updatedAt);
    error NavOutOfRange();
    error OutsideBand(uint160 sqrtPriceX96);
    error InsufficientBalance();
    error InsufficientAllowance();
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
    constructor(
        address manager,
        address assetToken,
        address dollarToken,
        address feed,
        string memory shareName,
        string memory shareSymbol
    ) {
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
        // Dollar tokens have 6 to 18 decimals; fewer would leave a $10 first deposit too few units.
        uint256 dollarDecimals = IRwaPoolToken(dollarToken).decimals();
        uint256 priceDecimals = uint256(IRwaNavFeed(feed).decimals()) + IRwaPoolToken(assetToken).decimals();
        if (dollarDecimals < 6 || dollarDecimals > 18 || priceDecimals > 36) revert InvalidToken();

        poolManager = IPoolManager(manager);
        navFeed = IRwaNavFeed(feed);
        asset = assetToken;
        dollar = dollarToken;
        bool assetFirst = assetToken < dollarToken;
        assetIsCurrency0 = assetFirst;
        currency0 = Currency.wrap(assetFirst ? assetToken : dollarToken);
        currency1 = Currency.wrap(assetFirst ? dollarToken : assetToken);
        decimals = uint8(dollarDecimals);
        dollarUnit = 10 ** dollarDecimals;
        navUnit = 10 ** priceDecimals;
        minFirstDeposit = 10 * 10 ** dollarDecimals;
        name = shareName;
        symbol = shareSymbol;

        PoolKey memory key = poolKey();
        poolId = key.toId();
        (uint160 sqrtPriceX96, uint256 updatedAt, ) = _nav();
        poolManager.initialize(key, sqrtPriceX96);
        _setPeg(_center(sqrtPriceX96), updatedAt);
    }

    // ---- Liquidity providers ----

    /// @notice Deposits up to `amount0Max` of currency0 and `amount1Max` of currency1 (both approved
    ///         to this contract) at the ratio the hook holds the two tokens, taking only what that
    ///         ratio needs. The deposit waits for the first NAV record published after it: the re-peg
    ///         to that record puts it to work and mints its shares, valuing it and the holdings at
    ///         that NAV, and `claimShares` pays them out (`withdraw` and the next `deposit` claim
    ///         first). Until then `cancelDeposit` returns it. A fresh record the pool has not re-pegged
    ///         to yet is applied first, so a deposit cannot become liquidity just before trades its
    ///         depositor can already see, and while the latest record is dated ahead of the chain's
    ///         clock deposits revert until it can be. A maximum above 2^128 - 1 counts as that, so
    ///         `type(uint256).max` lets the other token decide. The first deposit instead takes both
    ///         amounts in full, needs a fresh NAV, mints their value at the NAV in dollar-token units
    ///         as shares at once and opens the ranges; `shares` is 0 for every later deposit.
    function deposit(uint256 amount0Max, uint256 amount1Max, uint256 deadline)
        external
        nonReentrant
        beforeDeadline(deadline)
        returns (uint256 shares, uint256 amount0, uint256 amount1)
    {
        _claim(msg.sender);
        bytes memory result = poolManager.unlock(abi.encode(Action.Deposit, msg.sender, amount0Max, amount1Max));
        (shares, amount0, amount1) = abi.decode(result, (uint256, uint256, uint256));
    }

    /// @notice Returns the caller's deposit that is still waiting for the next NAV record.
    function cancelDeposit() external nonReentrant returns (uint256 amount0, uint256 amount1) {
        bytes memory result = poolManager.unlock(abi.encode(Action.Cancel, msg.sender, uint256(0), uint256(0)));
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
    }

    /// @notice Pays `account` the shares its deposit became at a re-peg. Anyone can call it.
    function claimShares(address account) external nonReentrant returns (uint256 shares) {
        return _claim(account);
    }

    /// @notice Burns `shares` and pays their part of the ranges and of the idle claims, fees
    ///         included. Works with any NAV, stale or missing. Claims the caller's converted deposit
    ///         first.
    function withdraw(uint256 shares, uint256 amount0Min, uint256 amount1Min, uint256 deadline)
        external
        nonReentrant
        beforeDeadline(deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        if (shares == 0) revert InvalidAmount();
        _claim(msg.sender);
        bytes memory result = poolManager.unlock(abi.encode(Action.Withdraw, msg.sender, shares, uint256(0)));
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
        if (amount0 < amount0Min || amount1 < amount1Min) revert SlippageExceeded();
        emit Withdrawn(msg.sender, shares, amount0, amount1);
    }

    /// @notice Re-pegs the pool to a NAV record newer than `peggedAt`; the first swap after a record
    ///         does the same. Anyone can call it. Returns false when there is no newer record.
    function repeg() external nonReentrant returns (bool repegged) {
        return abi.decode(poolManager.unlock(abi.encode(Action.Repeg, address(0), uint256(0), uint256(0))), (bool));
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (Action action, address account, uint256 a, uint256 b) = abi.decode(data, (Action, address, uint256, uint256));
        if (action == Action.Deposit) {
            (uint256 shares, uint256 amount0, uint256 amount1) = _deposit(account, a, b);
            return abi.encode(shares, amount0, amount1);
        }
        if (action == Action.Cancel) {
            (uint256 amount0, uint256 amount1) = _cancel(account);
            return abi.encode(amount0, amount1);
        }
        if (action == Action.Withdraw) {
            (uint256 amount0, uint256 amount1) = _withdraw(account, a);
            return abi.encode(amount0, amount1);
        }
        (uint160 sqrtPriceX96, uint256 updatedAt, uint256 answer) = _nav();
        if (updatedAt == peggedAt) return abi.encode(false);
        _repeg(sqrtPriceX96, updatedAt, answer);
        return abi.encode(true);
    }

    // ---- Hook callbacks ----

    /// @dev The hook opens its one pool itself, in the constructor.
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

    /// @dev Needs a NAV at most MAX_NAV_AGE old, re-pegs first when the NAV record is newer than
    ///      the ranges, and sets the fee for the NAV's age.
    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (_locked != 1) revert Reentrancy();
        (uint160 sqrtPriceX96, uint256 updatedAt, uint256 answer) = _nav();
        if (updatedAt != peggedAt) _repeg(sqrtPriceX96, updatedAt, answer);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, _fee(updatedAt) | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, int128)
    {
        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(poolId);
        if (sqrtPriceX96 < bandLowerSqrtPriceX96 || sqrtPriceX96 > bandUpperSqrtPriceX96) revert OutsideBand(sqrtPriceX96);
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

    /// @notice The NAV swaps use now: the feed's answer, its `updatedAt` and the pool price it maps
    ///         to. Reverts when the NAV is missing or older than MAX_NAV_AGE.
    function nav() external view returns (uint256 answer, uint256 updatedAt, uint160 sqrtPriceX96) {
        (sqrtPriceX96, updatedAt, answer) = _nav();
    }

    /// @notice The fee a swap pays now, in hundredths of a basis point. Reverts like `nav()`.
    function currentFee() external view returns (uint24) {
        (, uint256 updatedAt, ) = _nav();
        return _fee(updatedAt);
    }

    /// @notice Everything the shares own now, per currency: the ranges at the pool's price, their
    ///         uncollected fees and the idle claims, without the deposits waiting for the next
    ///         re-peg. Rounded down.
    function totalAmounts() public view returns (uint256 amount0, uint256 amount1) {
        (uint160 sqrtPriceX96, int24 tick, , ) = poolManager.getSlot0(poolId);
        (amount0, amount1) = _pendingFees();
        amount0 += idle0 - pending0;
        amount1 += idle1 - pending1;
        (uint256 base0, uint256 base1) = _amountsFor(baseRange, sqrtPriceX96, tick);
        (uint256 limit0, uint256 limit1) = _amountsFor(limitRange, sqrtPriceX96, tick);
        amount0 += base0 + limit0;
        amount1 += base1 + limit1;
    }

    /// @notice `totalAmounts()` valued at the NAV, in dollar-token units. Reverts like `nav()`.
    function totalValue() external view returns (uint256) {
        (, , uint256 answer) = _nav();
        (uint256 amount0, uint256 amount1) = totalAmounts();
        return _value(amount0, amount1, answer);
    }

    /// @notice What `deposit` would take now for these maxima: the ratio of the holdings, or both
    ///         amounts in full for the first deposit.
    function previewDeposit(uint256 amount0Max, uint256 amount1Max) external view returns (uint256 amount0, uint256 amount1) {
        uint256 supply = totalSupply;
        if (supply == 0) return (amount0Max, amount1Max);
        (uint256 held0, uint256 held1) = totalAmounts();
        (, amount0, amount1) = _sharesFor(amount0Max, amount1Max, held0, held1, supply);
    }

    /// @notice The shares these amounts would buy at the current NAV and holdings: exact for the
    ///         first deposit; for a later one an estimate, since its shares are set at the next
    ///         re-peg. Reverts like `nav()`.
    function estimateShares(uint256 amount0, uint256 amount1) external view returns (uint256) {
        (, , uint256 answer) = _nav();
        uint256 supply = totalSupply;
        if (supply == 0) return _firstShares(amount0, amount1, answer);
        (uint256 held0, uint256 held1) = totalAmounts();
        uint256 heldValue = _value(held0, held1, answer);
        uint256 value = _value(amount0, amount1, answer);
        return FullMath.mulDiv(value, supply, heldValue == 0 ? 1 : heldValue);
    }

    /// @notice The shares `account` can claim now from a deposit a re-peg has converted.
    function claimableShares(address account) public view returns (uint256) {
        Pending memory waiting = pendingOf[account];
        if ((waiting.amount0 == 0 && waiting.amount1 == 0) || waiting.epoch == epoch) return 0;
        Conversion memory conversion = conversions[waiting.epoch];
        if (conversion.value == 0) return 0;
        return FullMath.mulDiv(_value(waiting.amount0, waiting.amount1, conversion.answer), conversion.shares, conversion.value);
    }

    /// @notice What `withdraw` would pay now for `shares`.
    function previewWithdraw(uint256 shares) external view returns (uint256 amount0, uint256 amount1) {
        uint256 supply = totalSupply;
        if (shares == 0 || shares > supply) revert InvalidAmount();
        (uint160 sqrtPriceX96, int24 tick, , ) = poolManager.getSlot0(poolId);
        (uint256 fees0, uint256 fees1) = _pendingFees();
        amount0 = FullMath.mulDiv(idle0 - pending0 + fees0, shares, supply);
        amount1 = FullMath.mulDiv(idle1 - pending1 + fees1, shares, supply);
        Range memory part = baseRange;
        part.liquidity = _part(part.liquidity, shares, supply);
        (uint256 base0, uint256 base1) = _amountsFor(part, sqrtPriceX96, tick);
        part = limitRange;
        part.liquidity = _part(part.liquidity, shares, supply);
        (uint256 limit0, uint256 limit1) = _amountsFor(part, sqrtPriceX96, tick);
        amount0 += base0 + limit0;
        amount1 += base1 + limit1;
    }

    // ---- LP share token ----

    function approve(address spender, uint256 value) external returns (bool) {
        if (spender == address(0)) revert InvalidAddress();
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 available = allowance[from][msg.sender];
        if (available < value) revert InsufficientAllowance();
        if (available != type(uint256).max) {
            allowance[from][msg.sender] = available - value;
            emit Approval(from, msg.sender, available - value);
        }
        _transfer(from, to, value);
        return true;
    }

    // ---- Inside the pool manager's unlock ----

    function _deposit(address account, uint256 amount0Max, uint256 amount1Max)
        private
        returns (uint256 shares, uint256 amount0, uint256 amount1)
    {
        uint256 supply = totalSupply;
        if (supply == 0) {
            (uint160 sqrtPriceX96, uint256 updatedAt, uint256 answer) = _nav();
            shares = _firstShares(amount0Max, amount1Max, answer);
            (amount0, amount1) = (amount0Max, amount1Max);
            _mint(address(0), MINIMUM_SHARES);
            _mint(account, shares);
            _receive(currency0, account, amount0);
            _receive(currency1, account, amount1);
            _toIdle(amount0, amount1);
            emit Deposited(account, epoch, amount0, amount1);
            _repeg(sqrtPriceX96, updatedAt, answer);
            return (shares, amount0, amount1);
        }
        // A fresh record not applied yet would convert the deposit at the next swap, the one its
        // depositor may be waiting for; apply it now, so the deposit waits for a later record. A
        // record dated ahead of the chain's clock is already out too and would convert it once the
        // clock catches up, so the deposit waits until that record can be applied.
        try this.nav() returns (uint256 answer, uint256 updatedAt, uint160 sqrtPriceX96) {
            if (updatedAt != peggedAt) {
                _repeg(sqrtPriceX96, updatedAt, answer);
                _claim(account);
            }
        } catch (bytes memory reason) {
            if (bytes4(reason) == NavInFuture.selector) {
                assembly ("memory-safe") {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
        }
        // A re-peg above minted the converted deposits' shares, and their tokens are now holdings.
        supply = totalSupply;
        _collectFees();
        (uint256 held0, uint256 held1) = _holdings();
        (, amount0, amount1) = _sharesFor(amount0Max, amount1Max, held0, held1, supply);
        _receive(currency0, account, amount0);
        _receive(currency1, account, amount1);
        _toIdle(amount0, amount1);
        pending0 += amount0;
        pending1 += amount1;
        // Any earlier deposit was claimed first, so a waiting one is from this epoch.
        Pending storage waiting = pendingOf[account];
        waiting.amount0 = _toUint128(waiting.amount0 + amount0);
        waiting.amount1 = _toUint128(waiting.amount1 + amount1);
        waiting.epoch = uint64(epoch);
        emit Deposited(account, epoch, amount0, amount1);
    }

    function _cancel(address account) private returns (uint256 amount0, uint256 amount1) {
        Pending memory waiting = pendingOf[account];
        (amount0, amount1) = (waiting.amount0, waiting.amount1);
        if ((amount0 == 0 && amount1 == 0) || waiting.epoch != epoch) revert NothingToCancel();
        delete pendingOf[account];
        pending0 -= amount0;
        pending1 -= amount1;
        _fromIdle(amount0, amount1);
        if (amount0 > 0) poolManager.take(currency0, account, amount0);
        if (amount1 > 0) poolManager.take(currency1, account, amount1);
        emit DepositCancelled(account, epoch, amount0, amount1);
    }

    /// @dev Pays out a converted deposit's shares from the hook's balance.
    function _claim(address account) private returns (uint256 shares) {
        Pending memory waiting = pendingOf[account];
        if ((waiting.amount0 == 0 && waiting.amount1 == 0) || waiting.epoch == epoch) return 0;
        shares = claimableShares(account);
        delete pendingOf[account];
        if (shares > 0) _transfer(address(this), account, shares);
        emit SharesClaimed(account, waiting.epoch, shares);
    }

    function _withdraw(address account, uint256 shares) private returns (uint256 amount0, uint256 amount1) {
        uint256 supply = totalSupply;
        _burn(account, shares);
        _collectFees();
        amount0 = FullMath.mulDiv(idle0 - pending0, shares, supply);
        amount1 = FullMath.mulDiv(idle1 - pending1, shares, supply);
        _fromIdle(amount0, amount1);
        (uint256 base0, uint256 base1) = _remove(baseRange, BASE_SALT, _part(baseRange.liquidity, shares, supply));
        (uint256 limit0, uint256 limit1) = _remove(limitRange, LIMIT_SALT, _part(limitRange.liquidity, shares, supply));
        amount0 += base0 + limit0;
        amount1 += base1 + limit1;
        if (amount0 > 0) poolManager.take(currency0, account, amount0);
        if (amount1 > 0) poolManager.take(currency1, account, amount1);
    }

    /// @dev Takes both ranges out, turns the waiting deposits into shares, moves the empty pool to
    ///      the NAV and places the base and limit ranges around it with everything the hook holds.
    ///      Runs inside an unlock; the hook's balance with the pool manager is zero again when it
    ///      returns.
    function _repeg(uint160 navSqrtPriceX96, uint256 updatedAt, uint256 answer) private {
        int24 center = _center(navSqrtPriceX96);
        (uint256 base0, uint256 base1) = _remove(baseRange, BASE_SALT, baseRange.liquidity);
        (uint256 limit0, uint256 limit1) = _remove(limitRange, LIMIT_SALT, limitRange.liquidity);
        _toIdle(base0 + limit0, base1 + limit1);
        _convert(answer);

        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(poolId);
        if (sqrtPriceX96 != navSqrtPriceX96) {
            // With no liquidity in the pool this exchanges nothing: the price moves to the limit.
            poolManager.swap(
                poolKey(),
                SwapParams({zeroForOne: navSqrtPriceX96 < sqrtPriceX96, amountSpecified: -1, sqrtPriceLimitX96: navSqrtPriceX96}),
                ""
            );
        }

        Range memory base = Range(center - BASE_TICKS, center + TICK_SPACING + BASE_TICKS, 0);
        base.liquidity = _liquidityForAmounts(
            navSqrtPriceX96, TickMath.getSqrtPriceAtTick(base.lower), TickMath.getSqrtPriceAtTick(base.upper), idle0, idle1
        );
        _add(base, BASE_SALT);

        // What the base range could not use sells from the side of the NAV where it is wanted: extra
        // currency0 in a range just above the price, extra currency1 just below it.
        Range memory ask = Range(center + TICK_SPACING, center + TICK_SPACING + LIMIT_TICKS, 0);
        ask.liquidity = _liquidityForAmount0(TickMath.getSqrtPriceAtTick(ask.lower), TickMath.getSqrtPriceAtTick(ask.upper), idle0);
        Range memory bid = Range(center - LIMIT_TICKS, center, 0);
        bid.liquidity = _liquidityForAmount1(TickMath.getSqrtPriceAtTick(bid.lower), TickMath.getSqrtPriceAtTick(bid.upper), idle1);
        Range memory limit = ask.liquidity >= bid.liquidity ? ask : bid;
        _add(limit, LIMIT_SALT);

        baseRange = base;
        limitRange = limit;
        _setPeg(center, updatedAt);
        emit Repegged(
            updatedAt, answer, navSqrtPriceX96, base.lower, base.upper, base.liquidity, limit.lower, limit.upper, limit.liquidity
        );
    }

    /// @dev Mints the epoch's deposits their shares: their value at the NAV against the value of
    ///      everything else held, fees included, rounded down. Then a new epoch begins.
    function _convert(uint256 answer) private {
        uint256 waiting0 = pending0;
        uint256 waiting1 = pending1;
        if (waiting0 > 0 || waiting1 > 0) {
            uint256 value = _value(waiting0, waiting1, answer);
            uint256 heldValue = _value(idle0 - waiting0, idle1 - waiting1, answer);
            uint256 shares = FullMath.mulDiv(value, totalSupply, heldValue == 0 ? 1 : heldValue);
            conversions[epoch] = Conversion(uint128(answer), _toUint128(value), shares);
            (pending0, pending1) = (0, 0);
            _mint(address(this), shares);
            emit Converted(epoch, answer, value, shares);
        }
        epoch += 1;
    }

    /// @dev The NAV's tick rounded down to TICK_SPACING, with room for the band on both sides.
    function _center(uint160 navSqrtPriceX96) private pure returns (int24 center) {
        int24 tick = TickMath.getTickAtSqrtPrice(navSqrtPriceX96);
        center = tick / TICK_SPACING * TICK_SPACING;
        if (tick < center) center -= TICK_SPACING;
        if (center - BAND_TICKS < TickMath.MIN_TICK || center + TICK_SPACING + BAND_TICKS > TickMath.MAX_TICK) {
            revert NavOutOfRange();
        }
    }

    function _setPeg(int24 center, uint256 updatedAt) private {
        peggedAt = updatedAt;
        bandLowerSqrtPriceX96 = TickMath.getSqrtPriceAtTick(center - BAND_TICKS);
        bandUpperSqrtPriceX96 = TickMath.getSqrtPriceAtTick(center + TICK_SPACING + BAND_TICKS);
    }

    /// @dev Adds `range.liquidity` (which the idle balances cover) and pays for it from them.
    function _add(Range memory range, bytes32 salt) private {
        if (range.liquidity == 0) return;
        (BalanceDelta delta, ) = poolManager.modifyLiquidity(
            poolKey(), ModifyLiquidityParams(range.lower, range.upper, int256(uint256(range.liquidity)), salt), ""
        );
        _fromIdle(uint256(uint128(-delta.amount0())), uint256(uint128(-delta.amount1())));
    }

    /// @dev Removes `liquidity` from a range and returns what it pays, which the caller settles.
    function _remove(Range storage range, bytes32 salt, uint128 liquidity) private returns (uint256 amount0, uint256 amount1) {
        if (liquidity == 0) return (0, 0);
        (BalanceDelta delta, ) = poolManager.modifyLiquidity(
            poolKey(), ModifyLiquidityParams(range.lower, range.upper, -int256(uint256(liquidity)), salt), ""
        );
        range.liquidity -= liquidity;
        return (uint256(uint128(delta.amount0())), uint256(uint128(delta.amount1())));
    }

    /// @dev Collects both ranges' fees into the idle balances.
    function _collectFees() private {
        uint256 fees0;
        uint256 fees1;
        PoolKey memory key = poolKey();
        Range memory range = baseRange;
        if (range.liquidity > 0) {
            (BalanceDelta delta, ) = poolManager.modifyLiquidity(key, ModifyLiquidityParams(range.lower, range.upper, 0, BASE_SALT), "");
            (fees0, fees1) = (uint256(uint128(delta.amount0())), uint256(uint128(delta.amount1())));
        }
        range = limitRange;
        if (range.liquidity > 0) {
            (BalanceDelta delta, ) = poolManager.modifyLiquidity(key, ModifyLiquidityParams(range.lower, range.upper, 0, LIMIT_SALT), "");
            fees0 += uint256(uint128(delta.amount0()));
            fees1 += uint256(uint128(delta.amount1()));
        }
        _toIdle(fees0, fees1);
    }

    /// @dev Turns a credit with the pool manager into idle claims.
    function _toIdle(uint256 amount0, uint256 amount1) private {
        if (amount0 > 0) {
            poolManager.mint(address(this), currency0.toId(), amount0);
            idle0 += amount0;
        }
        if (amount1 > 0) {
            poolManager.mint(address(this), currency1.toId(), amount1);
            idle1 += amount1;
        }
    }

    /// @dev Burns idle claims into a credit with the pool manager, which the caller spends.
    function _fromIdle(uint256 amount0, uint256 amount1) private {
        if (amount0 > 0) {
            idle0 -= amount0;
            poolManager.burn(address(this), currency0.toId(), amount0);
        }
        if (amount1 > 0) {
            idle1 -= amount1;
            poolManager.burn(address(this), currency1.toId(), amount1);
        }
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

    // ---- Pricing and accounting ----

    /// @dev The NAV at most MAX_NAV_AGE old and the pool price it maps to. A record dated more than
    ///      CLOCK_TOLERANCE after the block is refused: it would not age.
    function _nav() private view returns (uint160 sqrtPriceX96, uint256 updatedAt, uint256 answer) {
        (, int256 reported, , uint256 updated, ) = navFeed.latestRoundData();
        if (reported <= 0 || updated == 0) revert NavUnavailable();
        if (updated > block.timestamp + CLOCK_TOLERANCE) revert NavInFuture(updated);
        if (block.timestamp > updated + MAX_NAV_AGE) revert NavTooOld(updated);
        if (uint256(reported) > type(uint128).max) revert NavOutOfRange();
        answer = uint256(reported);
        updatedAt = updated;
        // Pool prices are currency1 per currency0 in base units, as a Q64.96 square root. The price
        // must stay below 2^64 in base units for its square to fit in 256 bits.
        uint256 dollarsPerAsset = answer * dollarUnit;
        (uint256 numerator, uint256 denominator) = assetIsCurrency0 ? (dollarsPerAsset, navUnit) : (navUnit, dollarsPerAsset);
        if (numerator / denominator >= 1 << 64) revert NavOutOfRange();
        uint256 root = _sqrt(FullMath.mulDiv(numerator, 1 << 192, denominator));
        // Below 2^64 the price's root stays under MAX_SQRT_PRICE; only the lower bound can fail.
        if (root <= TickMath.MIN_SQRT_PRICE) revert NavOutOfRange();
        sqrtPriceX96 = uint160(root);
    }

    function _fee(uint256 updatedAt) private view returns (uint24) {
        uint256 age = block.timestamp > updatedAt ? block.timestamp - updatedAt : 0;
        return uint24(MIN_FEE + (uint256(MAX_FEE - MIN_FEE) * age) / MAX_NAV_AGE);
    }

    /// @dev Value at the NAV in dollar-token units, rounded down.
    function _value(uint256 amount0, uint256 amount1, uint256 answer) private view returns (uint256) {
        (uint256 assetAmount, uint256 dollarAmount) = assetIsCurrency0 ? (amount0, amount1) : (amount1, amount0);
        return FullMath.mulDiv(assetAmount, answer * dollarUnit, navUnit) + dollarAmount;
    }

    function _firstShares(uint256 amount0, uint256 amount1, uint256 answer) private view returns (uint256) {
        uint256 value = _value(amount0, amount1, answer);
        if (value < minFirstDeposit) revert BelowMinimum();
        return value - MINIMUM_SHARES;
    }

    /// @dev The most shares the maxima buy at the holdings' ratio and what they cost, rounded up.
    ///      Each cost is at most its maximum: shares × held / supply ≤ maximum for every token held.
    function _sharesFor(uint256 amount0Max, uint256 amount1Max, uint256 held0, uint256 held1, uint256 supply)
        private
        pure
        returns (uint256 shares, uint256 amount0, uint256 amount1)
    {
        // A deposit's amounts are kept as uint128 (`pendingOf`); a larger maximum lets the other token decide.
        if (amount0Max > type(uint128).max) amount0Max = type(uint128).max;
        if (amount1Max > type(uint128).max) amount1Max = type(uint128).max;
        shares = type(uint256).max;
        if (held0 > 0) shares = FullMath.mulDiv(amount0Max, supply, held0);
        if (held1 > 0) {
            uint256 byAmount1 = FullMath.mulDiv(amount1Max, supply, held1);
            if (byAmount1 < shares) shares = byAmount1;
        }
        if (shares == type(uint256).max) revert NoLiquidity();
        if (shares == 0) revert InvalidAmount();
        amount0 = FullMath.mulDivRoundingUp(held0, shares, supply);
        amount1 = FullMath.mulDivRoundingUp(held1, shares, supply);
    }

    /// @dev What the shares own after `_collectFees`: the ranges at the pool's price and the idle
    ///      claims, without the waiting deposits.
    function _holdings() private view returns (uint256 amount0, uint256 amount1) {
        (uint160 sqrtPriceX96, int24 tick, , ) = poolManager.getSlot0(poolId);
        (uint256 base0, uint256 base1) = _amountsFor(baseRange, sqrtPriceX96, tick);
        (uint256 limit0, uint256 limit1) = _amountsFor(limitRange, sqrtPriceX96, tick);
        return (idle0 - pending0 + base0 + limit0, idle1 - pending1 + base1 + limit1);
    }

    /// @dev What removing a range's liquidity would pay at this price, rounded down as the pool
    ///      manager rounds it, using the pool's tick the way the pool manager does.
    function _amountsFor(Range memory range, uint160 sqrtPriceX96, int24 tick) private pure returns (uint256 amount0, uint256 amount1) {
        if (range.liquidity == 0) return (0, 0);
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(range.lower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(range.upper);
        if (tick < range.lower) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, range.liquidity, false);
        } else if (tick < range.upper) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtUpper, range.liquidity, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtPriceX96, range.liquidity, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, range.liquidity, false);
        }
    }

    /// @dev Both ranges' uncollected fees, computed the way the pool manager pays them.
    function _pendingFees() private view returns (uint256 fees0, uint256 fees1) {
        (fees0, fees1) = _pendingFeesOf(baseRange, BASE_SALT);
        (uint256 limit0, uint256 limit1) = _pendingFeesOf(limitRange, LIMIT_SALT);
        fees0 += limit0;
        fees1 += limit1;
    }

    function _pendingFeesOf(Range memory range, bytes32 salt) private view returns (uint256 fees0, uint256 fees1) {
        if (range.liquidity == 0) return (0, 0);
        (uint256 inside0, uint256 inside1) = poolManager.getFeeGrowthInside(poolId, range.lower, range.upper);
        bytes32 positionId = keccak256(abi.encodePacked(address(this), range.lower, range.upper, salt));
        (, uint256 last0, uint256 last1) = poolManager.getPositionInfo(poolId, positionId);
        unchecked {
            fees0 = FullMath.mulDiv(inside0 - last0, range.liquidity, FixedPoint128.Q128);
            fees1 = FullMath.mulDiv(inside1 - last1, range.liquidity, FixedPoint128.Q128);
        }
    }

    function _part(uint128 liquidity, uint256 shares, uint256 supply) private pure returns (uint128) {
        return uint128(FullMath.mulDiv(liquidity, shares, supply));
    }

    // Uniswap's LiquidityAmounts, rounded down. Adding the result never needs more than the amounts
    // given: the pool manager rounds the amounts owed up from a liquidity rounded down from them.
    function _liquidityForAmounts(uint160 sqrtPriceX96, uint160 sqrtLower, uint160 sqrtUpper, uint256 amount0, uint256 amount1)
        private
        pure
        returns (uint128)
    {
        if (sqrtPriceX96 <= sqrtLower) return _liquidityForAmount0(sqrtLower, sqrtUpper, amount0);
        if (sqrtPriceX96 >= sqrtUpper) return _liquidityForAmount1(sqrtLower, sqrtUpper, amount1);
        uint128 liquidity0 = _liquidityForAmount0(sqrtPriceX96, sqrtUpper, amount0);
        uint128 liquidity1 = _liquidityForAmount1(sqrtLower, sqrtPriceX96, amount1);
        return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
    }

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

    /// @dev Floor of the square root by Newton's method, as OpenZeppelin's Math.sqrt: start from a
    ///      power of two within a factor of two of the root; seven steps then reach it.
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

    // ---- LP share internals ----

    // The hook's own balance holds converted deposits until their depositors claim them.
    function _transfer(address from, address to, uint256 value) private {
        if (to == address(0) || (to == address(this) && from != address(this))) revert InvalidAddress();
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        balanceOf[from] = balance - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    // Minting to the zero address locks the first deposit's MINIMUM_SHARES for good.
    function _mint(address to, uint256 value) private {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) private {
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        balanceOf[from] = balance - value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }
}
