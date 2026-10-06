// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

interface IRangeHook {
    function poolManager() external view returns (IPoolManager);
    function poolKey() external view returns (PoolKey memory);
    function asset() external view returns (address);
    function dollar() external view returns (address);
    function assetIsCurrency0() external view returns (bool);
    function nav() external view returns (uint256 answer, uint256 updatedAt, uint160 sqrtPriceX96);
    function currentFee() external view returns (uint24);
}

interface IRangeFund {
    function dollar() external view returns (address);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function currentNav() external view returns (uint256 navPerShareMicros, uint64 effectiveAt);
    function invest(uint256 dollars, uint256 minShares) external returns (uint256 shares);
    function redeem(uint256 shares, uint256 minDollars) external returns (uint256 dollars);
}

interface IRangeDollar {
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title GanymedeRangeArbitrage
/// @notice Brings GanymedeRangeLiquidityHook's pool back to the NAV through the fund, in one
///         transaction: below the NAV it buys USTX in the pool and redeems it at the fund, above it
///         sells USTX into the pool that it invests for at the fund. The swap stops where the pool's
///         price, net of its fee, meets the NAV, so the last unit traded still pays. Every demo
///         dollar left over, and any USTX the fund's $10 minimum investment bought beyond what the
///         pool took, goes to the caller; the transaction reverts unless the demo dollars come to at
///         least `minProfit`. Where no position holds liquidity between the price and the NAV, the
///         swap moves the price across that empty stretch and trades nothing, for a profit of 0.
///         Where the pool pays less than the fund needs, the caller makes up the difference from
///         demo dollars they have approved to this contract, for a profit of 0: selling into less
///         than the fund's $10 minimum investment, when the USTX bought beyond what the pool took is
///         worth at the NAV at least what they put in, or a rounding remainder of up to a cent when
///         buying in the pool. So the pool never stays stuck away from the NAV, where positions
///         cannot open.
/// @dev Holds nothing between transactions and has no owner. The USTX token is the fund itself.
///      Only the caller's own demo dollars are ever drawn, and only within their call.
contract GanymedeRangeArbitrage is IUnlockCallback {
    using StateLibrary for IPoolManager;

    uint256 private constant ONE_SHARE = 1e6;
    uint256 private constant MIN_INVESTMENT = 10 * 10 ** 6;
    /// @dev The most a purchase in the pool may draw from the caller: a rounding remainder, a cent at most.
    uint256 private constant MAX_REMAINDER = 10_000;
    uint256 private constant PIPS = 1_000_000;

    IRangeHook public immutable hook;
    IPoolManager public immutable poolManager;
    IRangeFund public immutable fund;
    IRangeDollar public immutable dollar;
    bool private immutable assetIsCurrency0;

    event Arbitraged(address indexed trader, bool boughtInPool, uint256 sharesMoved, uint256 profit, uint256 navPerShareMicros);

    error NotPoolManager();
    error InvalidAddress();
    error NothingToDo();
    error Unprofitable(uint256 profit);
    error TransferFailed();

    constructor(address rangeHook, address basketFund) {
        hook = IRangeHook(rangeHook);
        poolManager = IRangeHook(rangeHook).poolManager();
        fund = IRangeFund(basketFund);
        dollar = IRangeDollar(IRangeHook(rangeHook).dollar());
        assetIsCurrency0 = IRangeHook(rangeHook).assetIsCurrency0();
        if (IRangeHook(rangeHook).asset() != basketFund || IRangeFund(basketFund).dollar() != address(dollar)) revert InvalidAddress();
        if (!dollar.approve(basketFund, type(uint256).max)) revert TransferFailed();
    }

    /// @notice Trades the pool to the NAV and keeps the difference. Call it with eth_call first: the
    ///         result is the profit in demo dollars, or a revert when there is nothing to gain.
    function arbitrage(uint256 minProfit) external returns (uint256 profit) {
        (bool buyInPool, uint160 limit) = _direction();
        bytes memory result = poolManager.unlock(abi.encode(buyInPool, limit, msg.sender));
        uint256 moved;
        (profit, moved) = abi.decode(result, (uint256, uint256));
        if (profit < minProfit) revert Unprofitable(profit);
        if (!dollar.transfer(msg.sender, dollar.balanceOf(address(this)))) revert TransferFailed();
        uint256 extra = fund.balanceOf(address(this));
        if (extra > 0 && !fund.transfer(msg.sender, extra)) revert TransferFailed();
        (uint256 navMicros, ) = fund.currentNav();
        emit Arbitraged(msg.sender, buyInPool, moved, profit, navMicros);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (bool buyInPool, uint160 limit, address caller) = abi.decode(data, (bool, uint160, address));
        PoolKey memory key = hook.poolKey();
        // Buying USTX in the pool pays demo dollars for it; selling pays USTX for demo dollars.
        bool zeroForOne = buyInPool ? !assetIsCurrency0 : assetIsCurrency0;
        BalanceDelta delta = poolManager.swap(key, SwapParams(zeroForOne, -int256(uint256(type(uint128).max >> 1)), limit), "");
        (int128 assetDelta, int128 dollarDelta) = assetIsCurrency0 ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        Currency assetCurrency = Currency.wrap(address(fund));
        Currency dollarCurrency = Currency.wrap(address(dollar));
        if (buyInPool) {
            uint256 shares = uint256(uint128(assetDelta));
            uint256 owed = uint256(uint128(-dollarDelta));
            // Nothing between the price and the NAV: the price moved across an empty stretch.
            if (shares == 0 && owed == 0) return abi.encode(uint256(0), uint256(0));
            if (shares == 0) revert NothingToDo();
            poolManager.take(assetCurrency, address(this), shares);
            uint256 dollars = fund.redeem(shares, 0);
            // At most a rounding remainder: the swap stops where buying costs the NAV.
            if (dollars < owed) {
                if (owed - dollars > MAX_REMAINDER) revert Unprofitable(0);
                _draw(caller, owed - dollars);
            }
            _pay(dollarCurrency, owed);
            return abi.encode(dollars > owed ? dollars - owed : 0, shares);
        }
        uint256 owedShares = uint256(uint128(-assetDelta));
        uint256 received = uint256(uint128(dollarDelta));
        if (owedShares == 0 && received == 0) return abi.encode(uint256(0), uint256(0));
        if (owedShares == 0) revert NothingToDo();
        poolManager.take(dollarCurrency, address(this), received);
        (uint256 navMicros, ) = fund.currentNav();
        // Enough demo dollars for the shares owed at the fund's rounding, and at least its minimum.
        uint256 invest = (owedShares * navMicros + ONE_SHARE - 1) / ONE_SHARE + 1;
        if (invest < MIN_INVESTMENT) invest = MIN_INVESTMENT;
        // Less than the fund's minimum came out of the pool: the caller makes up the rest, and the
        // USTX it buys beyond what the pool took goes to them, worth at the NAV what they put in and
        // what the pool paid over the NAV.
        if (invest > received) _draw(caller, invest - received);
        fund.invest(invest, owedShares);
        _payShares(assetCurrency, owedShares);
        return abi.encode(received > invest ? received - invest : 0, owedShares);
    }

    /// @dev Which way the pool is off the NAV, and the price the swap stops at: where the last unit
    ///      breaks even after the fee, NAV·(1 − fee) buying in the pool and NAV / (1 − fee) selling
    ///      into it. Reverts when the pool is within its fee of the NAV.
    function _direction() private view returns (bool buyInPool, uint160 limit) {
        (, , uint160 navSqrt) = hook.nav();
        uint24 fee = hook.currentFee();
        (uint160 poolSqrt, , , ) = poolManager.getSlot0(hook.poolKey().toId());
        // Pool prices are currency1 per currency0; USTX is cheap in the pool when its price in demo
        // dollars is below the NAV.
        bool assetCheap = assetIsCurrency0 ? poolSqrt < navSqrt : poolSqrt > navSqrt;
        uint256 lowSqrt = uint256(navSqrt) * _sqrt((PIPS - fee) * PIPS) / PIPS;
        uint256 highSqrt = uint256(navSqrt) * _sqrt(PIPS * PIPS * PIPS / (PIPS - fee)) / PIPS;
        // In currency1-per-currency0 terms, buying the asset (currency0) raises the price toward the
        // NAV less the fee; when the asset is currency1 the directions swap.
        if (assetIsCurrency0) {
            limit = uint160(assetCheap ? lowSqrt : highSqrt);
            if (assetCheap ? poolSqrt >= limit : poolSqrt <= limit) revert NothingToDo();
        } else {
            limit = uint160(assetCheap ? highSqrt : lowSqrt);
            if (assetCheap ? poolSqrt <= limit : poolSqrt >= limit) revert NothingToDo();
        }
        if (limit <= TickMath.MIN_SQRT_PRICE || limit >= TickMath.MAX_SQRT_PRICE) revert NothingToDo();
        buyInPool = assetCheap;
    }

    function _draw(address caller, uint256 amount) private {
        if (!dollar.transferFrom(caller, address(this), amount)) revert TransferFailed();
    }

    function _pay(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        if (!dollar.transfer(address(poolManager), amount)) revert TransferFailed();
        poolManager.settle();
    }

    function _payShares(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        if (!fund.transfer(address(poolManager), amount)) revert TransferFailed();
        poolManager.settle();
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
