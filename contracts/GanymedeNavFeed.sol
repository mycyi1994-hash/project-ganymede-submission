// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface INavSource {
    function latestNav(bytes32 productId)
        external
        view
        returns (uint256 navPerShareMicros, uint256 sharesOutstandingMicros, bytes32 holdingsHash, uint64 effectiveAt, uint64 publishedAt);
}

/// @title GanymedeNavFeed
/// @notice One product's NAV from GanymedeNavRegistry, in the AggregatorV3Interface shape that
///         Chainlink price feeds use, so lending markets, vaults and dashboards on X Layer can read
///         it without custom code. It has no owner and no state of its own: every answer is the
///         registry's latest record for the product.
/// @dev Answers have 8 decimals, like Chainlink's USD feeds. The round ID is the record's effective
///      time, which the registry only lets grow, and `startedAt` and `updatedAt` are that same
///      time, so a staleness check on `updatedAt` measures the age of the prices themselves, not of
///      the transaction that published them. Only the latest round is on chain; earlier records
///      are in the registry's NavPublished events.
contract GanymedeNavFeed {
    uint8 public constant decimals = 8;
    uint256 public constant version = 1;
    // Registry NAVs have 6 decimals.
    uint256 private constant MICROS_TO_ANSWER = 100;

    INavSource public immutable registry;
    bytes32 public immutable productId;
    string public description;

    error InvalidAddress();
    error InvalidProduct();
    error NoDataPresent();

    constructor(address navRegistry, bytes32 feedProductId, string memory feedDescription) {
        if (navRegistry == address(0)) revert InvalidAddress();
        if (feedProductId == bytes32(0)) revert InvalidProduct();
        registry = INavSource(navRegistry);
        productId = feedProductId;
        description = feedDescription;
    }

    function latestRoundData()
        public
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (uint256 navPerShareMicros, , , uint64 effectiveAt, ) = registry.latestNav(productId);
        if (navPerShareMicros == 0 || effectiveAt == 0) revert NoDataPresent();
        roundId = uint80(effectiveAt);
        answer = int256(navPerShareMicros * MICROS_TO_ANSWER);
        startedAt = effectiveAt;
        updatedAt = effectiveAt;
        answeredInRound = roundId;
    }

    /// @notice The latest round only; any other round ID reverts with NoDataPresent.
    function getRoundData(uint80 requestedRoundId)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (roundId, answer, startedAt, updatedAt, answeredInRound) = latestRoundData();
        if (requestedRoundId != roundId) revert NoDataPresent();
    }

    // The older AggregatorInterface reads, still used by some integrations.
    function latestAnswer() external view returns (int256 answer) {
        (, answer, , , ) = latestRoundData();
    }

    function latestTimestamp() external view returns (uint256 updatedAt) {
        (, , , updatedAt, ) = latestRoundData();
    }

    function latestRound() external view returns (uint256) {
        (uint80 roundId, , , , ) = latestRoundData();
        return roundId;
    }
}
