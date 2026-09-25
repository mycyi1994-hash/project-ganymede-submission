// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MultiplierToken
/// @notice For tests only; never deployed. Keeps balances as shares times a multiplier, as xStocks do,
///         so a transfer can arrive a base unit short and a dividend, split or fee changes every
///         balance at once.
contract MultiplierToken {
    uint256 public multiplier = 1e18;
    mapping(address => uint256) public sharesOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(address holder, uint256 amount) {
        sharesOf[holder] = amount;
    }

    function setMultiplier(uint256 value) external {
        multiplier = value;
    }

    function balanceOf(address account) external view returns (uint256) {
        return (sharesOf[account] * multiplier) / 1e18;
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
        uint256 shares = (value * 1e18) / multiplier;
        sharesOf[from] -= shares;
        sharesOf[to] += shares;
    }
}
