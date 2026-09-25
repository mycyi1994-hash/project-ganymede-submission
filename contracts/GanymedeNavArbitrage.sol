// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IArbDollar {
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IArbFund {
    function dollar() external view returns (address);
    function currentNav() external view returns (uint256 navPerShareMicros, uint64 effectiveAt);
    function approve(address spender, uint256 value) external returns (bool);
    function invest(uint256 dollars, uint256 minShares) external returns (uint256 shares);
    function redeem(uint256 shares, uint256 minDollars) external returns (uint256 dollars);
}

interface IArbPool {
    function fund() external view returns (address);
    function FEE_BPS() external view returns (uint256);
    function getReserves() external view returns (uint256 shares, uint256 dollars);
    function quoteBuy(uint256 dollarsIn) external view returns (uint256 sharesOut);
    function quoteSell(uint256 sharesIn) external view returns (uint256 dollarsOut);
    function buy(uint256 dollarsIn, uint256 minSharesOut, uint256 deadline) external returns (uint256 sharesOut);
    function sell(uint256 sharesIn, uint256 minDollarsOut, uint256 deadline) external returns (uint256 dollarsOut);
}

/// @title GanymedeNavArbitrage
/// @notice Closes the gap between the USTX pool price and the NAV in one transaction, the way ETF
///         creation and redemption keep a fund's market price near its NAV. Below the NAV it buys
///         USTX in the pool and redeems it at the fund; above the NAV it invests at the fund and
///         sells the new USTX in the pool. The caller puts in demo dollars and receives every demo
///         dollar that comes back; the transaction reverts unless that is at least the input plus
///         `minProfit`.
/// @dev Holds nothing between transactions and has no owner.
contract GanymedeNavArbitrage {
    uint256 private constant BPS = 10_000;
    uint256 private constant ONE_SHARE = 1e6;
    // The fund's MIN_INVESTMENT: it refuses smaller investments.
    uint256 private constant MIN_INVESTMENT = 10 * 10 ** 6;

    IArbPool public immutable pool;
    IArbFund public immutable fund;
    IArbDollar public immutable dollar;

    event Arbitraged(address indexed trader, bool boughtInPool, uint256 dollarsIn, uint256 dollarsOut, uint256 navPerShareMicros);

    error InvalidAddress();
    error Unprofitable(uint256 dollarsIn, uint256 dollarsOut);
    error TransferFailed();

    constructor(address ustxPool) {
        if (ustxPool == address(0)) revert InvalidAddress();
        IArbFund basketFund = IArbFund(IArbPool(ustxPool).fund());
        IArbDollar demoDollar = IArbDollar(basketFund.dollar());
        pool = IArbPool(ustxPool);
        fund = basketFund;
        dollar = demoDollar;
        // The fund and the pool pull from this contract only inside a caller's transaction.
        if (!demoDollar.approve(address(basketFund), type(uint256).max)) revert TransferFailed();
        if (!demoDollar.approve(ustxPool, type(uint256).max)) revert TransferFailed();
        if (!basketFund.approve(ustxPool, type(uint256).max)) revert TransferFailed();
    }

    /// @notice Pool below NAV: buys USTX in the pool with `dollarsIn` demo dollars (approved to this
    ///         contract) and redeems it at the fund.
    function buyAndRedeem(uint256 dollarsIn, uint256 minProfit) external returns (uint256 dollarsOut) {
        _receive(dollarsIn);
        uint256 shares = pool.buy(dollarsIn, 0, block.timestamp);
        dollarsOut = fund.redeem(shares, 0);
        _settle(true, dollarsIn, dollarsOut, minProfit);
    }

    /// @notice Pool above NAV: invests `dollarsIn` demo dollars (approved to this contract) at the
    ///         fund and sells the new USTX in the pool.
    function investAndSell(uint256 dollarsIn, uint256 minProfit) external returns (uint256 dollarsOut) {
        _receive(dollarsIn);
        uint256 shares = fund.invest(dollarsIn, 0);
        dollarsOut = pool.sell(shares, 0, block.timestamp);
        _settle(false, dollarsIn, dollarsOut, minProfit);
    }

    /// @notice The trade that captures most of the gap now: whether it buys in the pool (pool below
    ///         NAV) or sells into it (above NAV), the demo dollars to put in and the demo dollars
    ///         expected back. `dollarsIn` is 0 when the gap does not cover the pool fee. Reverts
    ///         without a usable NAV.
    function quote() external view returns (bool buyInPool, uint256 dollarsIn, uint256 dollarsOut) {
        (uint256 nav, ) = fund.currentNav();
        (uint256 s, uint256 d) = pool.getReserves();
        if (s == 0 || d == 0) return (false, 0, 0);
        uint256 keep = BPS - pool.FEE_BPS();
        // Buying x dollars of USTX and redeeming it gains most where (d + γx)² = γ·s·d·NAV, γ = keep/BPS.
        uint256 root = _sqrt(keep * s * d / BPS * nav / ONE_SHARE);
        if (root > d) {
            dollarsIn = (root - d) * BPS / keep;
            if (dollarsIn == 0) return (true, 0, 0);
            dollarsOut = pool.quoteBuy(dollarsIn) * nav / ONE_SHARE;
            return dollarsOut > dollarsIn ? (true, dollarsIn, dollarsOut) : (true, 0, 0);
        }
        // Investing k shares' worth and selling them gains most where (s + γk)² = γ·s·d / NAV.
        root = _sqrt(keep * s * d / BPS * ONE_SHARE / nav);
        if (root <= s) return (false, 0, 0);
        uint256 shares = (root - s) * BPS / keep;
        dollarsIn = shares * nav / ONE_SHARE;
        if (dollarsIn < MIN_INVESTMENT) return (false, 0, 0);
        dollarsOut = pool.quoteSell(dollarsIn * ONE_SHARE / nav);
        return dollarsOut > dollarsIn ? (false, dollarsIn, dollarsOut) : (false, 0, 0);
    }

    function _receive(uint256 amount) internal {
        if (!dollar.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    function _settle(bool boughtInPool, uint256 dollarsIn, uint256 dollarsOut, uint256 minProfit) internal {
        if (dollarsOut < dollarsIn + minProfit) revert Unprofitable(dollarsIn, dollarsOut);
        if (!dollar.transfer(msg.sender, dollarsOut)) revert TransferFailed();
        (uint256 nav, ) = fund.currentNav();
        emit Arbitraged(msg.sender, boughtInPool, dollarsIn, dollarsOut, nav);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
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
