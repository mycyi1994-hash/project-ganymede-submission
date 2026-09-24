// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title GanymedeNavRegistry
/// @notice Append-only publication registry for fund NAV and rebalance evidence.
contract GanymedeNavRegistry {
    struct NavSnapshot {
        uint256 navPerShareMicros;
        uint256 sharesOutstandingMicros;
        bytes32 holdingsHash;
        uint64 effectiveAt;
        uint64 publishedAt;
    }

    address public administrator;
    address public pendingAdministrator;
    address public publisher;
    bool public paused;

    mapping(bytes32 => NavSnapshot) public latestNav;
    mapping(bytes32 => bytes32) public latestRebalanceHash;
    mapping(bytes32 => bool) public publishedPayload;

    event NavPublished(bytes32 indexed productId, uint256 navPerShareMicros, uint256 sharesOutstandingMicros, bytes32 indexed holdingsHash, uint64 effectiveAt);
    event RebalancePublished(bytes32 indexed productId, bytes32 indexed rebalanceHash, uint64 effectiveAt);
    event PublisherChanged(address indexed previousPublisher, address indexed newPublisher);
    event AdministratorProposed(address indexed currentAdministrator, address indexed pendingAdministrator);
    event AdministratorAccepted(address indexed previousAdministrator, address indexed newAdministrator);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error Unauthorized();
    error InvalidAddress();
    error InvalidPayload();
    error StalePublication();
    error DuplicatePayload();
    error ContractPaused();

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    modifier onlyPublisher() {
        if (msg.sender != publisher) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(address initialAdministrator, address initialPublisher) {
        if (initialAdministrator == address(0) || initialPublisher == address(0)) revert InvalidAddress();
        administrator = initialAdministrator;
        publisher = initialPublisher;
    }

    function publishNav(
        bytes32 productId,
        uint256 navPerShareMicros,
        uint256 sharesOutstandingMicros,
        bytes32 holdingsHash,
        uint64 effectiveAt
    ) external onlyPublisher whenNotPaused {
        if (productId == bytes32(0) || holdingsHash == bytes32(0) || navPerShareMicros == 0) revert InvalidPayload();
        if (effectiveAt <= latestNav[productId].effectiveAt) revert StalePublication();
        bytes32 payloadHash = keccak256(abi.encode(productId, navPerShareMicros, sharesOutstandingMicros, holdingsHash, effectiveAt));
        if (publishedPayload[payloadHash]) revert DuplicatePayload();
        publishedPayload[payloadHash] = true;
        latestNav[productId] = NavSnapshot(navPerShareMicros, sharesOutstandingMicros, holdingsHash, effectiveAt, uint64(block.timestamp));
        emit NavPublished(productId, navPerShareMicros, sharesOutstandingMicros, holdingsHash, effectiveAt);
    }

    function publishRebalance(bytes32 productId, bytes32 rebalanceHash, uint64 effectiveAt) external onlyPublisher whenNotPaused {
        if (productId == bytes32(0) || rebalanceHash == bytes32(0)) revert InvalidPayload();
        bytes32 payloadHash = keccak256(abi.encode(productId, rebalanceHash, effectiveAt));
        if (publishedPayload[payloadHash]) revert DuplicatePayload();
        publishedPayload[payloadHash] = true;
        latestRebalanceHash[productId] = rebalanceHash;
        emit RebalancePublished(productId, rebalanceHash, effectiveAt);
    }

    function setPublisher(address newPublisher) external onlyAdministrator {
        if (newPublisher == address(0)) revert InvalidAddress();
        emit PublisherChanged(publisher, newPublisher);
        publisher = newPublisher;
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
}
