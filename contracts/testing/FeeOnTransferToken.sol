// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FeeOnTransferToken
/// @notice For tests only; never deployed. Keeps 1% of every transfer, so a vault that trusts the
///         amount sent instead of the amount received would be under-backed.
contract FeeOnTransferToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(address holder, uint256 amount) {
        balanceOf[holder] = amount;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        allowance[from][msg.sender] -= value;
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) private {
        balanceOf[from] -= value;
        balanceOf[to] += value - value / 100;
    }
}
