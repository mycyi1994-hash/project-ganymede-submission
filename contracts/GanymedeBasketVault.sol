// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVaultToken {
    function balanceOf(address account) external view returns (uint256);
}

/// @title GanymedeBasketVault
/// @notice A basket token backed by its constituents and created and redeemed in kind, the way an
///         ETF's authorized participants deliver and receive the underlying shares. The first
///         creation takes a fixed quantity of each constituent per share, set at deployment. After
///         that every share is an equal claim on everything the vault holds: creating shares
///         delivers each constituent in proportion to the holdings, and redeeming pays each out in
///         proportion. The vault prices nothing and has no owner, so no one can mint shares without
///         the tokens or move the tokens without burning shares.
/// @dev Shares have 6 decimals. xStocks keep balances as shares times a multiplier: a transfer can
///      arrive a base unit short (on a fork of X Layer mainnet, sending 10^18 AAPLx delivered
///      10^18 − 1), and a dividend, split or fee paid through the multiplier changes every balance.
///      Proportional creation and redemption pass such changes to the shares instead of stranding
///      them or leaving the vault short. Creation takes the proportional amount rounded up plus
///      ROUNDING_ALLOWANCE and refuses a call in which any token arrives short of the proportional
///      amount, so a fee-on-transfer token cannot dilute holders; redemption pays the proportional
///      amount rounded down less ROUNDING_ALLOWANCE. The first creation must be at least one whole
///      share, and every creation names the most of each token it will deliver, so no one can make
///      shares expensive by creating a dust share and donating to the vault. Not deployed: it runs
///      against the real xStocks on a fork of X Layer mainnet (npm run fork:vault).
contract GanymedeBasketVault {
    uint8 public constant decimals = 6;
    uint256 public constant SHARE = 1e6;
    uint256 public constant MAX_TOKENS = 20;
    /// @notice Base units added to each creation and kept from each redemption, per token.
    uint256 public constant ROUNDING_ALLOWANCE = 4;

    string public name;
    string public symbol;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address[] private _tokens;
    /// @dev Token base units per whole share (10^6 share units) for the first creation, one per token.
    uint256[] private _initialUnits;
    uint256 private _locked = 1;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Created(address indexed account, uint256 shares, uint256[] amounts);
    event Redeemed(address indexed account, uint256 shares, uint256[] amounts);

    error InvalidBasket();
    error InvalidAmount();
    error InsufficientBalance();
    error InsufficientAllowance();
    error TransferFailed();
    error ExceedsMaximum();
    error Reentrancy();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(string memory name_, string memory symbol_, address[] memory tokens_, uint256[] memory initialUnits_) {
        uint256 count = tokens_.length;
        if (count == 0 || count > MAX_TOKENS || initialUnits_.length != count) revert InvalidBasket();
        for (uint256 i = 0; i < count; i++) {
            if (tokens_[i] == address(0) || tokens_[i].code.length == 0 || initialUnits_[i] == 0) revert InvalidBasket();
            for (uint256 j = 0; j < i; j++) if (tokens_[j] == tokens_[i]) revert InvalidBasket();
        }
        name = name_;
        symbol = symbol_;
        _tokens = tokens_;
        _initialUnits = initialUnits_;
    }

    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    function initialUnits() external view returns (uint256[] memory) {
        return _initialUnits;
    }

    /// @notice What one whole share holds of each token now: the initial units before any shares exist.
    function holdingsPerShare() external view returns (uint256[] memory units) {
        units = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            units[i] = totalSupply == 0 ? _initialUnits[i] : (IVaultToken(_tokens[i]).balanceOf(address(this)) * SHARE) / totalSupply;
        }
    }

    /// @notice The proportional amount of each token behind `shares` (rounded up), what creating them
    ///         takes (that plus ROUNDING_ALLOWANCE) and what redeeming them pays.
    function amountsFor(uint256 shares) public view returns (uint256[] memory owed, uint256[] memory createIn, uint256[] memory redeemOut) {
        uint256 count = _tokens.length;
        owed = new uint256[](count);
        createIn = new uint256[](count);
        redeemOut = new uint256[](count);
        uint256 supply = totalSupply;
        for (uint256 i = 0; i < count; i++) {
            (uint256 numerator, uint256 denominator) = supply == 0
                ? (_initialUnits[i] * shares, SHARE)
                : (IVaultToken(_tokens[i]).balanceOf(address(this)) * shares, supply);
            uint256 exact = numerator / denominator;
            owed[i] = exact + (numerator % denominator == 0 ? 0 : 1);
            createIn[i] = owed[i] + ROUNDING_ALLOWANCE;
            redeemOut[i] = supply == 0 || shares > supply ? 0 : (exact > ROUNDING_ALLOWANCE ? exact - ROUNDING_ALLOWANCE : 0);
        }
    }

    /// @notice Delivers each constituent's share of the holdings for `shares` (approve each token
    ///         first) and mints the shares. `maxAmounts` is the most of each token the caller will
    ///         deliver, in token order, as `amountsFor` quotes it.
    function create(uint256 shares, uint256[] calldata maxAmounts) external nonReentrant returns (uint256[] memory amounts) {
        if (shares == 0 || (totalSupply == 0 && shares < SHARE)) revert InvalidAmount();
        if (maxAmounts.length != _tokens.length) revert InvalidAmount();
        uint256[] memory owed;
        (owed, amounts, ) = amountsFor(shares);
        for (uint256 i = 0; i < amounts.length; i++) if (amounts[i] > maxAmounts[i]) revert ExceedsMaximum();
        for (uint256 i = 0; i < amounts.length; i++) {
            address token = _tokens[i];
            uint256 before = IVaultToken(token).balanceOf(address(this));
            _call(token, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amounts[i])); // transferFrom
            if (IVaultToken(token).balanceOf(address(this)) - before < owed[i]) revert TransferFailed();
        }
        totalSupply += shares;
        balanceOf[msg.sender] += shares;
        emit Transfer(address(0), msg.sender, shares);
        emit Created(msg.sender, shares, amounts);
    }

    /// @notice Burns `shares` and pays the caller their share of every constituent.
    function redeem(uint256 shares) external nonReentrant returns (uint256[] memory amounts) {
        if (shares == 0) revert InvalidAmount();
        if (balanceOf[msg.sender] < shares) revert InsufficientBalance();
        (, , amounts) = amountsFor(shares);
        balanceOf[msg.sender] -= shares;
        totalSupply -= shares;
        emit Transfer(msg.sender, address(0), shares);
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] > 0) _call(_tokens[i], abi.encodeWithSelector(0xa9059cbb, msg.sender, amounts[i])); // transfer
        }
        emit Redeemed(msg.sender, shares, amounts);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        if (from == address(0) || to == address(0) || to == address(this)) revert InvalidAmount();
        if (balanceOf[from] < value) revert InsufficientBalance();
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    /// @dev Accepts tokens that return true or nothing, like OpenZeppelin's SafeERC20.
    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory result) = token.call(data);
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }
}
