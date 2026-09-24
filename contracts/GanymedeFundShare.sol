// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title GanymedeFundShare
/// @notice Restricted-transfer fund share ledger for GIWA settlement.
/// @dev Administration and issuance roles should be controlled by independent multisigs.
contract GanymedeFundShare {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    address public administrator;
    address public pendingAdministrator;
    address public issuer;
    address public transferAgent;
    bool public paused;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public isAllowed;
    mapping(bytes32 => bool) public processedSettlement;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event InvestorPermission(address indexed investor, bool allowed);
    event SubscriptionSettled(bytes32 indexed settlementId, address indexed investor, uint256 shares);
    event RedemptionSettled(bytes32 indexed settlementId, address indexed investor, uint256 shares);
    event IssuerChanged(address indexed previousIssuer, address indexed newIssuer);
    event TransferAgentChanged(address indexed previousAgent, address indexed newAgent);
    event AdministratorProposed(address indexed currentAdministrator, address indexed pendingAdministrator);
    event AdministratorAccepted(address indexed previousAdministrator, address indexed newAdministrator);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error Unauthorized();
    error InvalidAddress();
    error InvalidAmount();
    error TransferRestricted();
    error ContractPaused();
    error SettlementAlreadyProcessed();
    error InsufficientBalance();
    error InsufficientAllowance();

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert Unauthorized();
        _;
    }

    modifier onlyTransferAgentOrAdministrator() {
        if (msg.sender != transferAgent && msg.sender != administrator) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(string memory fundName, string memory fundSymbol, address initialAdministrator) {
        if (initialAdministrator == address(0)) revert InvalidAddress();
        name = fundName;
        symbol = fundSymbol;
        administrator = initialAdministrator;
        issuer = initialAdministrator;
        transferAgent = initialAdministrator;
        isAllowed[initialAdministrator] = true;
        emit InvestorPermission(initialAdministrator, true);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        if (spender == address(0)) revert InvalidAddress();
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external whenNotPaused returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external whenNotPaused returns (bool) {
        uint256 available = allowance[from][msg.sender];
        if (available < value) revert InsufficientAllowance();
        if (available != type(uint256).max) {
            allowance[from][msg.sender] = available - value;
            emit Approval(from, msg.sender, available - value);
        }
        _transfer(from, to, value);
        return true;
    }

    function settleSubscription(bytes32 settlementId, address investor, uint256 shares) external onlyIssuer whenNotPaused {
        if (investor == address(0)) revert InvalidAddress();
        if (!isAllowed[investor]) revert TransferRestricted();
        if (shares == 0) revert InvalidAmount();
        _consumeSettlement(settlementId);
        totalSupply += shares;
        balanceOf[investor] += shares;
        emit Transfer(address(0), investor, shares);
        emit SubscriptionSettled(settlementId, investor, shares);
    }

    function settleRedemption(bytes32 settlementId, address investor, uint256 shares) external onlyIssuer whenNotPaused {
        if (shares == 0) revert InvalidAmount();
        _consumeSettlement(settlementId);
        uint256 balance = balanceOf[investor];
        if (balance < shares) revert InsufficientBalance();
        balanceOf[investor] = balance - shares;
        totalSupply -= shares;
        emit Transfer(investor, address(0), shares);
        emit RedemptionSettled(settlementId, investor, shares);
    }

    function setInvestorPermission(address investor, bool allowed) external onlyTransferAgentOrAdministrator {
        if (investor == address(0)) revert InvalidAddress();
        isAllowed[investor] = allowed;
        emit InvestorPermission(investor, allowed);
    }

    function setInvestorPermissions(address[] calldata investors, bool allowed) external onlyTransferAgentOrAdministrator {
        for (uint256 index = 0; index < investors.length; index++) {
            address investor = investors[index];
            if (investor == address(0)) revert InvalidAddress();
            isAllowed[investor] = allowed;
            emit InvestorPermission(investor, allowed);
        }
    }

    function setIssuer(address newIssuer) external onlyAdministrator {
        if (newIssuer == address(0)) revert InvalidAddress();
        emit IssuerChanged(issuer, newIssuer);
        issuer = newIssuer;
    }

    function setTransferAgent(address newTransferAgent) external onlyAdministrator {
        if (newTransferAgent == address(0)) revert InvalidAddress();
        emit TransferAgentChanged(transferAgent, newTransferAgent);
        transferAgent = newTransferAgent;
    }

    function pause() external onlyAdministrator {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAdministrator {
        paused = false;
        emit Unpaused(msg.sender);
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
        isAllowed[msg.sender] = true;
        emit AdministratorAccepted(previous, msg.sender);
        emit InvestorPermission(msg.sender, true);
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert InvalidAddress();
        if (!isAllowed[from] || !isAllowed[to]) revert TransferRestricted();
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        balanceOf[from] = balance - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _consumeSettlement(bytes32 settlementId) internal {
        if (settlementId == bytes32(0)) revert InvalidAmount();
        if (processedSettlement[settlementId]) revert SettlementAlreadyProcessed();
        processedSettlement[settlementId] = true;
    }
}
