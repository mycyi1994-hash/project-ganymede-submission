// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface INavRegistry {
    function latestNav(bytes32 productId)
        external
        view
        returns (uint256 navPerShareMicros, uint256 sharesOutstandingMicros, bytes32 holdingsHash, uint64 effectiveAt, uint64 publishedAt);
}

interface IDemoDollar {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function burn(uint256 value) external;
    function mint(address to, uint256 value) external;
}

/// @title GanymedeBasketFund
/// @notice Testnet fund shares, bought and redeemed with demo dollars at the NAV recorded in
///         GanymedeNavRegistry. Nobody can issue shares except by investing at that NAV.
/// @dev Holds no assets: invested demo dollars are burned and redemptions are paid in newly
///      minted demo dollars, so the fund is a demo of pricing and issuance, not of custody.
contract GanymedeBasketFund {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;

    uint256 public constant MIN_INVESTMENT = 10 * 10 ** 6;
    uint256 public constant MAX_NAV_AGE = 1 hours;

    IDemoDollar public immutable dollar;
    INavRegistry public immutable registry;
    bytes32 public immutable productId;

    uint256 public totalSupply;
    uint256 public investorCount;
    address public administrator;
    address public pendingAdministrator;
    bool public paused;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Invested(address indexed investor, uint256 dollars, uint256 shares, uint256 navPerShareMicros, uint64 navEffectiveAt);
    event Redeemed(address indexed investor, uint256 shares, uint256 dollars, uint256 navPerShareMicros, uint64 navEffectiveAt);
    event AdministratorProposed(address indexed currentAdministrator, address indexed pendingAdministrator);
    event AdministratorAccepted(address indexed previousAdministrator, address indexed newAdministrator);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error Unauthorized();
    error InvalidAddress();
    error InvalidAmount();
    error BelowMinimum();
    error NavUnavailable();
    error NavTooOld(uint64 effectiveAt);
    error SlippageExceeded();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ContractPaused();

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(
        string memory fundName,
        string memory fundSymbol,
        address demoDollar,
        address navRegistry,
        bytes32 fundProductId,
        address initialAdministrator
    ) {
        if (demoDollar == address(0) || navRegistry == address(0) || initialAdministrator == address(0)) revert InvalidAddress();
        if (fundProductId == bytes32(0)) revert InvalidAmount();
        name = fundName;
        symbol = fundSymbol;
        dollar = IDemoDollar(demoDollar);
        registry = INavRegistry(navRegistry);
        productId = fundProductId;
        administrator = initialAdministrator;
    }

    /// @notice The NAV orders fill at: the latest record, if it is at most MAX_NAV_AGE old.
    function currentNav() public view returns (uint256 navPerShareMicros, uint64 effectiveAt) {
        (navPerShareMicros, , , effectiveAt, ) = registry.latestNav(productId);
        if (navPerShareMicros == 0 || effectiveAt == 0) revert NavUnavailable();
        if (block.timestamp > uint256(effectiveAt) + MAX_NAV_AGE) revert NavTooOld(effectiveAt);
    }

    function previewInvest(uint256 dollars) external view returns (uint256 shares) {
        (uint256 nav, ) = currentNav();
        return dollars * 1e6 / nav;
    }

    function previewRedeem(uint256 shares) external view returns (uint256 dollars) {
        (uint256 nav, ) = currentNav();
        return shares * nav / 1e6;
    }

    /// @notice Buys shares with `dollars` demo dollars (approved to this contract) at the current
    ///         NAV, rounded down. Reverts unless at least `minShares` shares are issued.
    function invest(uint256 dollars, uint256 minShares) external whenNotPaused returns (uint256 shares) {
        if (dollars < MIN_INVESTMENT) revert BelowMinimum();
        (uint256 nav, uint64 effectiveAt) = currentNav();
        shares = dollars * 1e6 / nav;
        if (shares == 0 || shares < minShares) revert SlippageExceeded();
        if (!dollar.transferFrom(msg.sender, address(this), dollars)) revert InsufficientAllowance();
        dollar.burn(dollars);
        _mint(msg.sender, shares);
        emit Invested(msg.sender, dollars, shares, nav, effectiveAt);
    }

    /// @notice Sells `shares` at the current NAV for demo dollars, rounded down. Reverts unless at
    ///         least `minDollars` are paid.
    function redeem(uint256 shares, uint256 minDollars) external whenNotPaused returns (uint256 dollars) {
        if (shares == 0) revert InvalidAmount();
        (uint256 nav, uint64 effectiveAt) = currentNav();
        dollars = shares * nav / 1e6;
        if (dollars == 0 || dollars < minDollars) revert SlippageExceeded();
        _burn(msg.sender, shares);
        dollar.mint(msg.sender, dollars);
        emit Redeemed(msg.sender, shares, dollars, nav, effectiveAt);
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
        emit AdministratorAccepted(previous, msg.sender);
    }

    // investorCount tracks addresses with a non-zero balance, so it moves only when a balance
    // crosses zero.
    function _mint(address to, uint256 value) internal {
        uint256 balance = balanceOf[to];
        if (balance == 0 && value != 0) investorCount += 1;
        balanceOf[to] = balance + value;
        totalSupply += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        balanceOf[from] = balance - value;
        totalSupply -= value;
        if (balance == value && value != 0) investorCount -= 1;
        emit Transfer(from, address(0), value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        if (from != to && value != 0) {
            uint256 toBalance = balanceOf[to];
            balanceOf[from] = balance - value;
            balanceOf[to] = toBalance + value;
            if (balance == value) investorCount -= 1;
            if (toBalance == 0) investorCount += 1;
        }
        emit Transfer(from, to, value);
    }
}
