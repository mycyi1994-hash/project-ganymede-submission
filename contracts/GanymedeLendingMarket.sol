// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMarketDollar {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IMarketFund {
    function dollar() external view returns (address);
    function currentNav() external view returns (uint256 navPerShareMicros, uint64 effectiveAt);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title GanymedeLendingMarket
/// @notice Demo-dollar loans against USTX on X Layer Testnet. Lenders supply dUSD and earn the
///         interest borrowers pay. Borrowers post USTX, valued at the NAV the fund trades at, and
///         borrow dUSD against it. When a loan grows past LIQUIDATION_THRESHOLD of its collateral
///         value, anyone can repay part of it and take USTX at a discount, which the fund redeems
///         at NAV.
/// @dev Starts paused: nothing can be supplied or borrowed until the administrator unpauses it.
///      Pausing never blocks repaying, withdrawing or liquidating. Debt left after all of a
///      borrower's collateral is seized stays on that account; there is no bad-debt auction.
///      Amounts are in micros (6 decimals, like dUSD and USTX); indices, rates and factors are
///      scaled by 1e18. Rounding always favours the market.
contract GanymedeLendingMarket {
    uint256 private constant WAD = 1e18;
    uint256 private constant ONE_SHARE = 1e6;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    uint256 public constant BORROW_COLLATERAL_FACTOR = 0.50e18;
    uint256 public constant LIQUIDATION_THRESHOLD = 0.65e18;
    uint256 public constant LIQUIDATION_BONUS = 0.08e18;
    uint256 public constant CLOSE_FACTOR = 0.50e18;
    uint256 public constant RESERVE_FACTOR = 0.10e18;
    uint256 public constant MIN_BORROW = 10 * 10 ** 6;

    // Borrow rate per year: BASE + MULTIPLIER × utilization up to KINK, then JUMP_MULTIPLIER above it.
    uint256 public constant BASE_RATE_PER_YEAR = 0.02e18;
    uint256 public constant MULTIPLIER_PER_YEAR = 0.10e18;
    uint256 public constant JUMP_MULTIPLIER_PER_YEAR = 2e18;
    uint256 public constant KINK = 0.80e18;

    IMarketDollar public immutable dollar;
    IMarketFund public immutable fund;

    uint256 public supplyIndex;
    uint256 public borrowIndex;
    uint256 public lastAccrualTime;
    uint256 public totalSupplyPrincipal;
    uint256 public totalBorrowPrincipal;
    uint256 public totalCollateral;

    mapping(address => uint256) public supplyPrincipalOf;
    mapping(address => uint256) public borrowPrincipalOf;
    mapping(address => uint256) public collateralOf;

    address public administrator;
    address public pendingAdministrator;
    bool public paused;

    event Supplied(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event CollateralSupplied(address indexed account, uint256 shares);
    event CollateralWithdrawn(address indexed account, uint256 shares);
    event Borrowed(address indexed account, uint256 amount);
    event Repaid(address indexed account, uint256 amount);
    event Liquidated(address indexed liquidator, address indexed borrower, uint256 repaid, uint256 seized, uint256 navPerShareMicros);
    event AdministratorProposed(address indexed currentAdministrator, address indexed pendingAdministrator);
    event AdministratorAccepted(address indexed previousAdministrator, address indexed newAdministrator);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error Unauthorized();
    error InvalidAddress();
    error InvalidAmount();
    error BelowMinimum();
    error InsufficientBalance();
    error InsufficientLiquidity();
    error InsufficientCollateral();
    error NotLiquidatable();
    error SlippageExceeded();
    error TransferFailed();
    error ContractPaused();

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(address demoDollar, address basketFund, address initialAdministrator) {
        if (demoDollar == address(0) || basketFund == address(0) || initialAdministrator == address(0)) revert InvalidAddress();
        // Loans are in the dollar the fund redeems into, so seized USTX can always be sold back.
        if (IMarketFund(basketFund).dollar() != demoDollar) revert InvalidAddress();
        dollar = IMarketDollar(demoDollar);
        fund = IMarketFund(basketFund);
        administrator = initialAdministrator;
        supplyIndex = WAD;
        borrowIndex = WAD;
        lastAccrualTime = block.timestamp;
        paused = true;
    }

    // ---- Lenders ----

    /// @notice Lends `amount` dUSD (approved to this market). It earns interest from borrowers.
    function supply(uint256 amount) external whenNotPaused {
        accrueInterest();
        uint256 principal = amount * WAD / supplyIndex;
        if (principal == 0) revert InvalidAmount();
        supplyPrincipalOf[msg.sender] += principal;
        totalSupplyPrincipal += principal;
        _receiveDollars(msg.sender, amount);
        emit Supplied(msg.sender, amount);
    }

    /// @notice Withdraws lent dUSD with its interest; `type(uint256).max` withdraws all of it.
    function withdraw(uint256 amount) external returns (uint256 withdrawn) {
        accrueInterest();
        uint256 principal = supplyPrincipalOf[msg.sender];
        uint256 balance = principal * supplyIndex / WAD;
        uint256 burned;
        if (amount == type(uint256).max) {
            (withdrawn, burned) = (balance, principal);
        } else {
            if (amount > balance) revert InsufficientBalance();
            (withdrawn, burned) = (amount, _ceilDiv(amount * WAD, supplyIndex));
        }
        if (withdrawn == 0) revert InvalidAmount();
        if (withdrawn > cash()) revert InsufficientLiquidity();
        supplyPrincipalOf[msg.sender] = principal - burned;
        totalSupplyPrincipal -= burned;
        _sendDollars(msg.sender, withdrawn);
        emit Withdrawn(msg.sender, withdrawn);
    }

    // ---- Borrowers ----

    /// @notice Posts `shares` USTX (approved to this market) as collateral.
    function supplyCollateral(uint256 shares) external whenNotPaused {
        if (shares == 0) revert InvalidAmount();
        collateralOf[msg.sender] += shares;
        totalCollateral += shares;
        _receiveShares(msg.sender, shares);
        emit CollateralSupplied(msg.sender, shares);
    }

    /// @notice Takes back USTX collateral, as long as what stays still covers the loan;
    ///         `type(uint256).max` takes back all of it.
    function withdrawCollateral(uint256 shares) external returns (uint256 withdrawn) {
        accrueInterest();
        uint256 held = collateralOf[msg.sender];
        withdrawn = shares == type(uint256).max ? held : shares;
        if (withdrawn == 0) revert InvalidAmount();
        if (withdrawn > held) revert InsufficientBalance();
        collateralOf[msg.sender] = held - withdrawn;
        totalCollateral -= withdrawn;
        if (borrowPrincipalOf[msg.sender] != 0) _requireCovered(msg.sender);
        _sendShares(msg.sender, withdrawn);
        emit CollateralWithdrawn(msg.sender, withdrawn);
    }

    /// @notice Borrows `amount` dUSD against the caller's USTX, up to BORROW_COLLATERAL_FACTOR of
    ///         its value at the current NAV. A loan starts at MIN_BORROW.
    function borrow(uint256 amount) external whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        accrueInterest();
        if (amount > cash()) revert InsufficientLiquidity();
        uint256 added = _ceilDiv(amount * WAD, borrowIndex);
        borrowPrincipalOf[msg.sender] += added;
        totalBorrowPrincipal += added;
        if (_debtOf(msg.sender) < MIN_BORROW) revert BelowMinimum();
        _requireCovered(msg.sender);
        _sendDollars(msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    /// @notice Repays up to `amount` dUSD of the caller's loan. Any amount at or above the debt,
    ///         such as `type(uint256).max`, repays exactly the debt.
    function repay(uint256 amount) external returns (uint256 repaid) {
        accrueInterest();
        uint256 principal = borrowPrincipalOf[msg.sender];
        uint256 debt = _ceilDiv(principal * borrowIndex, WAD);
        uint256 burned;
        if (amount >= debt) {
            (repaid, burned) = (debt, principal);
        } else {
            (repaid, burned) = (amount, amount * WAD / borrowIndex);
        }
        if (burned == 0) revert InvalidAmount();
        borrowPrincipalOf[msg.sender] = principal - burned;
        totalBorrowPrincipal -= burned;
        _receiveDollars(msg.sender, repaid);
        emit Repaid(msg.sender, repaid);
    }

    // ---- Liquidators ----

    /// @notice Repays part of `borrower`'s loan once its debt exceeds LIQUIDATION_THRESHOLD of the
    ///         collateral value, and takes USTX worth the repayment plus LIQUIDATION_BONUS at the
    ///         current NAV. Repays at most CLOSE_FACTOR of the debt and at most `maxRepay`, and
    ///         reverts unless at least `minShares` USTX are received.
    function liquidate(address borrower, uint256 maxRepay, uint256 minShares) external returns (uint256 repaid, uint256 seized) {
        if (borrower == msg.sender) revert InvalidAddress();
        accrueInterest();
        (uint256 nav, ) = fund.currentNav();
        uint256 principal = borrowPrincipalOf[borrower];
        uint256 debt = _ceilDiv(principal * borrowIndex, WAD);
        uint256 held = collateralOf[borrower];
        if (debt == 0 || held == 0 || debt <= held * nav * LIQUIDATION_THRESHOLD / (ONE_SHARE * WAD)) revert NotLiquidatable();

        repaid = debt * CLOSE_FACTOR / WAD;
        if (repaid > maxRepay) repaid = maxRepay;
        if (repaid == 0) revert InvalidAmount();
        seized = repaid * (WAD + LIQUIDATION_BONUS) * ONE_SHARE / (WAD * nav);
        if (seized > held) {
            // Too little collateral left for the full bonus: take all of it for proportionally less.
            seized = held;
            repaid = _ceilDiv(held * nav * WAD, ONE_SHARE * (WAD + LIQUIDATION_BONUS));
        }
        if (seized == 0 || seized < minShares) revert SlippageExceeded();
        uint256 burned = repaid >= debt ? principal : repaid * WAD / borrowIndex;
        if (burned == 0) revert InvalidAmount();

        borrowPrincipalOf[borrower] = principal - burned;
        totalBorrowPrincipal -= burned;
        collateralOf[borrower] = held - seized;
        totalCollateral -= seized;
        _receiveDollars(msg.sender, repaid);
        _sendShares(msg.sender, seized);
        emit Liquidated(msg.sender, borrower, repaid, seized, nav);
    }

    // ---- Interest ----

    /// @notice Adds the interest since the last update to every loan and every lender's balance.
    function accrueInterest() public {
        if (block.timestamp == lastAccrualTime) return;
        (supplyIndex, borrowIndex) = _currentIndices();
        lastAccrualTime = block.timestamp;
    }

    // ---- Views ----

    /// @notice dUSD held by the market: what can be withdrawn or borrowed right now.
    function cash() public view returns (uint256) {
        return dollar.balanceOf(address(this));
    }

    function totalSupplied() public view returns (uint256) {
        (uint256 currentSupplyIndex, ) = _currentIndices();
        return totalSupplyPrincipal * currentSupplyIndex / WAD;
    }

    function totalBorrowed() public view returns (uint256) {
        (, uint256 currentBorrowIndex) = _currentIndices();
        return _ceilDiv(totalBorrowPrincipal * currentBorrowIndex, WAD);
    }

    /// @notice The market's share of the interest: dUSD held and lent out beyond what lenders are owed.
    function reserves() external view returns (uint256) {
        uint256 assets = cash() + totalBorrowed();
        uint256 owed = totalSupplied();
        return assets > owed ? assets - owed : 0;
    }

    function supplyBalanceOf(address account) external view returns (uint256) {
        (uint256 currentSupplyIndex, ) = _currentIndices();
        return supplyPrincipalOf[account] * currentSupplyIndex / WAD;
    }

    function borrowBalanceOf(address account) public view returns (uint256) {
        (, uint256 currentBorrowIndex) = _currentIndices();
        return _ceilDiv(borrowPrincipalOf[account] * currentBorrowIndex, WAD);
    }

    function utilization() public view returns (uint256) {
        return _utilization(totalBorrowed(), totalSupplied());
    }

    function borrowRatePerYear() external view returns (uint256) {
        return _borrowRatePerYear(utilization());
    }

    function supplyRatePerYear() external view returns (uint256) {
        uint256 used = utilization();
        return _borrowRatePerYear(used) * used / WAD * (WAD - RESERVE_FACTOR) / WAD;
    }

    /// @notice The collateral's value at the current NAV, how much it lets the account borrow, and
    ///         the debt above which the loan can be liquidated. Reverts without a usable NAV.
    function collateralValueOf(address account) public view returns (uint256 value, uint256 borrowLimit, uint256 liquidationLimit) {
        (uint256 nav, ) = fund.currentNav();
        uint256 shares = collateralOf[account];
        value = shares * nav / ONE_SHARE;
        borrowLimit = shares * nav * BORROW_COLLATERAL_FACTOR / (ONE_SHARE * WAD);
        liquidationLimit = shares * nav * LIQUIDATION_THRESHOLD / (ONE_SHARE * WAD);
    }

    function isLiquidatable(address account) external view returns (bool) {
        uint256 debt = borrowBalanceOf(account);
        if (debt == 0 || collateralOf[account] == 0) return false;
        (, , uint256 liquidationLimit) = collateralValueOf(account);
        return debt > liquidationLimit;
    }

    // ---- Administration ----

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

    // ---- Internals ----

    // The indices as of this block. Interest for the elapsed time is simple at the utilization of
    // the last update, and compounds at every update.
    function _currentIndices() internal view returns (uint256 currentSupplyIndex, uint256 currentBorrowIndex) {
        currentSupplyIndex = supplyIndex;
        currentBorrowIndex = borrowIndex;
        uint256 elapsed = block.timestamp - lastAccrualTime;
        if (elapsed == 0 || totalBorrowPrincipal == 0) return (currentSupplyIndex, currentBorrowIndex);
        uint256 borrowed = _ceilDiv(totalBorrowPrincipal * currentBorrowIndex, WAD);
        uint256 supplied = totalSupplyPrincipal * currentSupplyIndex / WAD;
        uint256 growth = _borrowRatePerYear(_utilization(borrowed, supplied)) * elapsed / SECONDS_PER_YEAR;
        currentBorrowIndex += currentBorrowIndex * growth / WAD;
        // Lenders share the interest pro rata; RESERVE_FACTOR of it stays in the market.
        if (totalSupplyPrincipal != 0) {
            currentSupplyIndex += borrowed * growth * (WAD - RESERVE_FACTOR) / (WAD * totalSupplyPrincipal);
        }
    }

    function _utilization(uint256 borrowed, uint256 supplied) internal pure returns (uint256) {
        if (borrowed == 0) return 0;
        if (borrowed >= supplied) return WAD;
        return borrowed * WAD / supplied;
    }

    function _borrowRatePerYear(uint256 used) internal pure returns (uint256) {
        if (used <= KINK) return BASE_RATE_PER_YEAR + MULTIPLIER_PER_YEAR * used / WAD;
        return BASE_RATE_PER_YEAR + MULTIPLIER_PER_YEAR * KINK / WAD + JUMP_MULTIPLIER_PER_YEAR * (used - KINK) / WAD;
    }

    // Debt with the stored index; call after accrueInterest.
    function _debtOf(address account) internal view returns (uint256) {
        return _ceilDiv(borrowPrincipalOf[account] * borrowIndex, WAD);
    }

    function _requireCovered(address account) internal view {
        (, uint256 borrowLimit, ) = collateralValueOf(account);
        if (_debtOf(account) > borrowLimit) revert InsufficientCollateral();
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    function _receiveDollars(address from, uint256 amount) internal {
        if (!dollar.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _sendDollars(address to, uint256 amount) internal {
        if (!dollar.transfer(to, amount)) revert TransferFailed();
    }

    function _receiveShares(address from, uint256 shares) internal {
        if (!fund.transferFrom(from, address(this), shares)) revert TransferFailed();
    }

    function _sendShares(address to, uint256 shares) internal {
        if (!fund.transfer(to, shares)) revert TransferFailed();
    }
}
