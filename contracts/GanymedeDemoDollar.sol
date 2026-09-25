// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title GanymedeDemoDollar
/// @notice Demo dollars for the Ganymede app on X Layer Testnet. They have no value.
///         Anyone can claim a fixed amount once a day; beyond that, only the fund
///         contract (the minter) issues them, when it pays out a redemption.
contract GanymedeDemoDollar {
    string public constant name = "Ganymede Demo Dollar";
    string public constant symbol = "dUSD";
    uint8 public constant decimals = 6;

    uint256 public constant CLAIM_AMOUNT = 10_000 * 10 ** 6;
    uint256 public constant CLAIM_INTERVAL = 1 days;

    uint256 public totalSupply;
    address public administrator;
    address public pendingAdministrator;
    address public minter;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public lastClaimAt;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Claimed(address indexed account, uint256 amount);
    event MinterChanged(address indexed previousMinter, address indexed newMinter);
    event AdministratorProposed(address indexed currentAdministrator, address indexed pendingAdministrator);
    event AdministratorAccepted(address indexed previousAdministrator, address indexed newAdministrator);

    error Unauthorized();
    error InvalidAddress();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ClaimTooSoon(uint256 nextClaimAt);

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    constructor(address initialAdministrator) {
        if (initialAdministrator == address(0)) revert InvalidAddress();
        administrator = initialAdministrator;
    }

    /// @notice Sends CLAIM_AMOUNT demo dollars to the caller, at most once per CLAIM_INTERVAL.
    function claim() external {
        uint256 next = nextClaimAt(msg.sender);
        if (block.timestamp < next) revert ClaimTooSoon(next);
        lastClaimAt[msg.sender] = block.timestamp;
        _mint(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT);
    }

    /// @notice The earliest time `account` can claim again; 0 when it never claimed.
    function nextClaimAt(address account) public view returns (uint256) {
        uint256 last = lastClaimAt[account];
        return last == 0 ? 0 : last + CLAIM_INTERVAL;
    }

    function mint(address to, uint256 value) external {
        if (msg.sender != minter) revert Unauthorized();
        _mint(to, value);
    }

    /// @notice Burns the caller's own demo dollars.
    function burn(uint256 value) external {
        uint256 balance = balanceOf[msg.sender];
        if (balance < value) revert InsufficientBalance();
        balanceOf[msg.sender] = balance - value;
        totalSupply -= value;
        emit Transfer(msg.sender, address(0), value);
    }

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

    function setMinter(address newMinter) external onlyAdministrator {
        if (newMinter == address(0)) revert InvalidAddress();
        emit MinterChanged(minter, newMinter);
        minter = newMinter;
    }

    function proposeAdministrator(address nextAdministrator) external onlyAdministrator {
        if (nextAdministrator == address(0)) revert InvalidAddress();
        pendingAdministrator = nextAdministrator;
        emit AdministratorProposed(administrator, nextAdministrator);
    }

    function acceptAdministrator() external {
        if (msg.sender != pendingAdministrator) revert Unauthorized();
        address previous = administrator;
        administrator = msg.sender;
        pendingAdministrator = address(0);
        emit AdministratorAccepted(previous, msg.sender);
    }

    function _mint(address to, uint256 value) internal {
        if (to == address(0)) revert InvalidAddress();
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        balanceOf[from] = balance - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
