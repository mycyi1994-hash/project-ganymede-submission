// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPoolDollar {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IPoolFund {
    function dollar() external view returns (address);
    function currentNav() external view returns (uint256 navPerShareMicros, uint64 effectiveAt);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title GanymedeUstxPool
/// @notice The secondary market for USTX on X Layer Testnet: a constant-product pool of USTX and
///         demo dollars (dUSD), next to the fund, which issues and redeems at NAV. Liquidity
///         providers earn a 0.3% fee on every trade. The pool's price moves only with trades, so it
///         drifts from the NAV as the NAV moves; GanymedeNavArbitrage closes the gap through the
///         fund in one transaction, the way ETF creation and redemption keep a fund near its NAV.
/// @dev Uniswap V2 arithmetic with the router's slippage and deadline checks built in. Reserves
///      are tracked, not read from balances, so tokens sent to the pool directly are ignored. The
///      first MINIMUM_LIQUIDITY of liquidity is locked. Amounts are in micros (6 decimals).
contract GanymedeUstxPool {
    string public constant name = "Ganymede USTX-dUSD LP";
    string public constant symbol = "USTX-LP";
    uint8 public constant decimals = 6;

    uint256 public constant FEE_BPS = 30;
    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    uint256 private constant BPS = 10_000;
    uint256 private constant ONE_SHARE = 1e6;

    IPoolFund public immutable fund;
    IPoolDollar public immutable dollar;

    uint256 public reserveShares;
    uint256 public reserveDollars;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event LiquidityAdded(address indexed provider, uint256 shares, uint256 dollars, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 shares, uint256 dollars, uint256 liquidity);
    event Bought(address indexed trader, uint256 dollarsIn, uint256 sharesOut);
    event Sold(address indexed trader, uint256 sharesIn, uint256 dollarsOut);
    event Reserves(uint256 shares, uint256 dollars);

    error InvalidAddress();
    error InvalidAmount();
    error Expired();
    error SlippageExceeded();
    error InsufficientLiquidity();
    error InsufficientBalance();
    error InsufficientAllowance();
    error TransferFailed();

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(address basketFund) {
        if (basketFund == address(0)) revert InvalidAddress();
        address demoDollar = IPoolFund(basketFund).dollar();
        if (demoDollar == address(0)) revert InvalidAddress();
        fund = IPoolFund(basketFund);
        dollar = IPoolDollar(demoDollar);
    }

    // ---- Liquidity ----

    /// @notice Adds USTX and demo dollars (both approved to this pool) at the pool's ratio; the first
    ///         deposit sets the price. Takes at most the desired amounts and at least the minimums.
    function addLiquidity(uint256 sharesDesired, uint256 dollarsDesired, uint256 minShares, uint256 minDollars, uint256 deadline)
        external
        beforeDeadline(deadline)
        returns (uint256 sharesIn, uint256 dollarsIn, uint256 liquidity)
    {
        uint256 rs = reserveShares;
        uint256 rd = reserveDollars;
        uint256 supply = totalSupply;
        if (supply == 0) {
            (sharesIn, dollarsIn) = (sharesDesired, dollarsDesired);
            uint256 root = _sqrt(sharesIn * dollarsIn);
            if (root <= MINIMUM_LIQUIDITY) revert InvalidAmount();
            liquidity = root - MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY);
        } else {
            uint256 dollarsAtRatio = sharesDesired * rd / rs;
            if (dollarsAtRatio <= dollarsDesired) {
                (sharesIn, dollarsIn) = (sharesDesired, dollarsAtRatio);
            } else {
                (sharesIn, dollarsIn) = (dollarsDesired * rs / rd, dollarsDesired);
            }
            liquidity = _min(sharesIn * supply / rs, dollarsIn * supply / rd);
        }
        if (sharesIn < minShares || dollarsIn < minDollars) revert SlippageExceeded();
        if (liquidity == 0) revert InvalidAmount();
        reserveShares = rs + sharesIn;
        reserveDollars = rd + dollarsIn;
        _mint(msg.sender, liquidity);
        _receiveShares(msg.sender, sharesIn);
        _receiveDollars(msg.sender, dollarsIn);
        emit LiquidityAdded(msg.sender, sharesIn, dollarsIn, liquidity);
        emit Reserves(rs + sharesIn, rd + dollarsIn);
    }

    /// @notice Burns `liquidity` and returns its share of both reserves.
    function removeLiquidity(uint256 liquidity, uint256 minShares, uint256 minDollars, uint256 deadline)
        external
        beforeDeadline(deadline)
        returns (uint256 sharesOut, uint256 dollarsOut)
    {
        uint256 supply = totalSupply;
        if (liquidity == 0 || supply == 0) revert InvalidAmount();
        uint256 rs = reserveShares;
        uint256 rd = reserveDollars;
        sharesOut = liquidity * rs / supply;
        dollarsOut = liquidity * rd / supply;
        if (sharesOut == 0 && dollarsOut == 0) revert InvalidAmount();
        if (sharesOut < minShares || dollarsOut < minDollars) revert SlippageExceeded();
        _burn(msg.sender, liquidity);
        reserveShares = rs - sharesOut;
        reserveDollars = rd - dollarsOut;
        _sendShares(msg.sender, sharesOut);
        _sendDollars(msg.sender, dollarsOut);
        emit LiquidityRemoved(msg.sender, sharesOut, dollarsOut, liquidity);
        emit Reserves(rs - sharesOut, rd - dollarsOut);
    }

    // ---- Trading ----

    /// @notice Buys USTX with `dollarsIn` demo dollars (approved to this pool).
    function buy(uint256 dollarsIn, uint256 minSharesOut, uint256 deadline) external beforeDeadline(deadline) returns (uint256 sharesOut) {
        sharesOut = quoteBuy(dollarsIn);
        if (sharesOut == 0 || sharesOut < minSharesOut) revert SlippageExceeded();
        uint256 rs = reserveShares - sharesOut;
        uint256 rd = reserveDollars + dollarsIn;
        (reserveShares, reserveDollars) = (rs, rd);
        _receiveDollars(msg.sender, dollarsIn);
        _sendShares(msg.sender, sharesOut);
        emit Bought(msg.sender, dollarsIn, sharesOut);
        emit Reserves(rs, rd);
    }

    /// @notice Sells `sharesIn` USTX (approved to this pool) for demo dollars.
    function sell(uint256 sharesIn, uint256 minDollarsOut, uint256 deadline) external beforeDeadline(deadline) returns (uint256 dollarsOut) {
        dollarsOut = quoteSell(sharesIn);
        if (dollarsOut == 0 || dollarsOut < minDollarsOut) revert SlippageExceeded();
        uint256 rs = reserveShares + sharesIn;
        uint256 rd = reserveDollars - dollarsOut;
        (reserveShares, reserveDollars) = (rs, rd);
        _receiveShares(msg.sender, sharesIn);
        _sendDollars(msg.sender, dollarsOut);
        emit Sold(msg.sender, sharesIn, dollarsOut);
        emit Reserves(rs, rd);
    }

    /// @notice USTX received for `dollarsIn` demo dollars now, after the fee.
    function quoteBuy(uint256 dollarsIn) public view returns (uint256 sharesOut) {
        return _amountOut(dollarsIn, reserveDollars, reserveShares);
    }

    /// @notice Demo dollars received for `sharesIn` USTX now, after the fee.
    function quoteSell(uint256 sharesIn) public view returns (uint256 dollarsOut) {
        return _amountOut(sharesIn, reserveShares, reserveDollars);
    }

    // ---- Views ----

    function getReserves() external view returns (uint256 shares, uint256 dollars) {
        return (reserveShares, reserveDollars);
    }

    /// @notice The pool's mid price in demo-dollar micros per USTX, before the fee; 0 while empty.
    function price() public view returns (uint256) {
        uint256 rs = reserveShares;
        return rs == 0 ? 0 : reserveDollars * ONE_SHARE / rs;
    }

    /// @notice The pool price against the fund's current NAV, in basis points: positive is a
    ///         premium, negative a discount. Reverts without a usable NAV or while the pool is empty.
    function premiumBps() external view returns (int256) {
        (uint256 nav, ) = fund.currentNav();
        uint256 mid = price();
        if (mid == 0) revert InsufficientLiquidity();
        return (int256(mid) - int256(nav)) * int256(BPS) / int256(nav);
    }

    // ---- LP token ----

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

    // ---- Internals ----

    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountIn == 0) revert InvalidAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 inAfterFee = amountIn * (BPS - FEE_BPS);
        return inAfterFee * reserveOut / (reserveIn * BPS + inAfterFee);
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        balanceOf[from] = balance - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    // Minting to the zero address locks the first MINIMUM_LIQUIDITY for good.
    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        balanceOf[from] = balance - value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    function _receiveShares(address from, uint256 shares) internal {
        if (!fund.transferFrom(from, address(this), shares)) revert TransferFailed();
    }

    function _sendShares(address to, uint256 shares) internal {
        if (!fund.transfer(to, shares)) revert TransferFailed();
    }

    function _receiveDollars(address from, uint256 amount) internal {
        if (!dollar.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _sendDollars(address to, uint256 amount) internal {
        if (!dollar.transfer(to, amount)) revert TransferFailed();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
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
