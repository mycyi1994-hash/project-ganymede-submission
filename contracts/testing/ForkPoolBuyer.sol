// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBuyerPool {
    function token0() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data) external returns (int256, int256);
}

interface IBuyerToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

interface IBuyerWrapper {
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
}

/// @title ForkPoolBuyer
/// @notice For tests on a fork of X Layer mainnet only; never deployed. Buys an xStock the way a
///         market maker would: pays a stablecoin it holds into the Uniswap V3 pool where the xStock's
///         ERC-4626 wrapper trades, then redeems the wrapper for the xStock itself.
contract ForkPoolBuyer {
    uint160 private constant MIN_SQRT_RATIO = 4295128739;
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    address private _pool;
    address private _payToken;
    uint256 private _amount;

    /// @notice Spends `amount` of `payToken` in `pool` and sends the unwrapped xStock to `recipient`.
    function buy(address pool, address payToken, address wrapper, uint256 amount, address recipient) external returns (uint256 assets) {
        bool zeroForOne = IBuyerPool(pool).token0() == payToken;
        _pool = pool;
        _payToken = payToken;
        _amount = amount;
        IBuyerPool(pool).swap(address(this), zeroForOne, int256(amount), zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1, "");
        _pool = address(0);
        assets = IBuyerWrapper(wrapper).redeem(IBuyerToken(wrapper).balanceOf(address(this)), recipient, address(this));
    }

    /// @dev Only the pool the current buy() named may collect, and at most the amount it offered. The
    ///      caller chooses that pool, so this is safe only in a test that passes the real pools.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        require(msg.sender == _pool, "unexpected caller");
        uint256 owed = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
        require(owed <= _amount, "more than offered");
        require(IBuyerToken(_payToken).transfer(msg.sender, owed), "payment failed");
    }
}
