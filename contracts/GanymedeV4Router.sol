// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title GanymedeV4Router
/// @notice Single-pool swaps on a Uniswap v4 pool manager where no Uniswap router serves it, as on X
///         Layer Testnet: exact input with a minimum output, or exact output with a maximum input,
///         each with a deadline, and quotes that run the same swap. The caller approves this
///         contract for the input token and receives the output.
/// @dev Holds nothing between transactions and has no owner. ERC-20 pools only. A swap that fills
///      less than the amount asked reverts. Quotes execute the swap inside the pool manager's unlock
///      and revert with the result, so call them with eth_call; they include everything the swap
///      would do, such as a hook's re-peg.
contract GanymedeV4Router is IUnlockCallback {
    IPoolManager public immutable poolManager;

    event Swapped(address indexed trader, PoolId indexed poolId, bool zeroForOne, uint256 amountIn, uint256 amountOut);

    error InvalidAddress();
    error InvalidAmount();
    error NativeCurrency();
    error NotPoolManager();
    error Expired();
    error SlippageExceeded();
    error PartialFill();
    error TransferFailed();
    error Quote(uint256 amountIn, uint256 amountOut);

    struct Order {
        address trader;
        PoolKey key;
        bool zeroForOne;
        int256 amountSpecified;
        bool quote;
    }

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(address manager) {
        if (manager == address(0)) revert InvalidAddress();
        poolManager = IPoolManager(manager);
    }

    /// @notice Sells exactly `amountIn` of the input token (currency0 when `zeroForOne`) for at least
    ///         `minAmountOut` of the other.
    function swapExactInput(PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint256 minAmountOut, uint256 deadline)
        external
        beforeDeadline(deadline)
        returns (uint256 amountOut)
    {
        (, amountOut) = _swap(Order(msg.sender, key, zeroForOne, -_signed(amountIn), false));
        if (amountOut < minAmountOut) revert SlippageExceeded();
    }

    /// @notice Buys exactly `amountOut` of the output token for at most `maxAmountIn` of the input.
    function swapExactOutput(PoolKey calldata key, bool zeroForOne, uint256 amountOut, uint256 maxAmountIn, uint256 deadline)
        external
        beforeDeadline(deadline)
        returns (uint256 amountIn)
    {
        (amountIn, ) = _swap(Order(msg.sender, key, zeroForOne, _signed(amountOut), false));
        if (amountIn > maxAmountIn) revert SlippageExceeded();
    }

    /// @notice The output `swapExactInput` would give now. Call with eth_call.
    function quoteExactInput(PoolKey calldata key, bool zeroForOne, uint256 amountIn) external returns (uint256 amountOut) {
        (, amountOut) = _quote(Order(msg.sender, key, zeroForOne, -_signed(amountIn), true));
    }

    /// @notice The input `swapExactOutput` would take now. Call with eth_call.
    function quoteExactOutput(PoolKey calldata key, bool zeroForOne, uint256 amountOut) external returns (uint256 amountIn) {
        (amountIn, ) = _quote(Order(msg.sender, key, zeroForOne, _signed(amountOut), true));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Order memory order = abi.decode(data, (Order));
        BalanceDelta delta = poolManager.swap(
            order.key,
            SwapParams({
                zeroForOne: order.zeroForOne,
                amountSpecified: order.amountSpecified,
                sqrtPriceLimitX96: order.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        (int128 inDelta, int128 outDelta) =
            order.zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        if (inDelta > 0 || outDelta < 0) revert PartialFill();
        uint256 amountIn = uint256(uint128(-inDelta));
        uint256 amountOut = uint256(uint128(outDelta));
        bool filled = order.amountSpecified < 0
            ? amountIn == uint256(-order.amountSpecified)
            : amountOut == uint256(order.amountSpecified);
        if (!filled) revert PartialFill();
        if (order.quote) revert Quote(amountIn, amountOut);

        (Currency input, Currency output) =
            order.zeroForOne ? (order.key.currency0, order.key.currency1) : (order.key.currency1, order.key.currency0);
        poolManager.sync(input);
        (bool ok, bytes memory result) = Currency.unwrap(input).call(
            abi.encodeWithSelector(0x23b872dd, order.trader, address(poolManager), amountIn) // transferFrom
        );
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
        poolManager.settle();
        poolManager.take(output, order.trader, amountOut);
        return abi.encode(amountIn, amountOut);
    }

    function _swap(Order memory order) private returns (uint256 amountIn, uint256 amountOut) {
        if (order.key.currency0.isAddressZero()) revert NativeCurrency();
        (amountIn, amountOut) = abi.decode(poolManager.unlock(abi.encode(order)), (uint256, uint256));
        emit Swapped(order.trader, order.key.toId(), order.zeroForOne, amountIn, amountOut);
    }

    function _quote(Order memory order) private returns (uint256 amountIn, uint256 amountOut) {
        if (order.key.currency0.isAddressZero()) revert NativeCurrency();
        try poolManager.unlock(abi.encode(order)) {
            revert InvalidAmount(); // a quote always reverts inside the unlock
        } catch (bytes memory reason) {
            if (reason.length != 68 || bytes4(reason) != Quote.selector) {
                assembly ("memory-safe") {
                    revert(add(reason, 32), mload(reason))
                }
            }
            assembly ("memory-safe") {
                amountIn := mload(add(reason, 36))
                amountOut := mload(add(reason, 68))
            }
        }
    }

    function _signed(uint256 amount) private pure returns (int256) {
        if (amount == 0 || amount > uint256(int256(type(int128).max))) revert InvalidAmount();
        return int256(amount);
    }
}
