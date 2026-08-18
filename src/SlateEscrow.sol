// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SlateEscrow
/// @notice Holds a depositor's escrow for a metered payment channel and pays it
/// out against a single ZK settlement proof.
///
/// A channel is opened by locking escrow here. Calls are then metered entirely
/// off-chain; the channel closes when someone submits a proof that the amount
/// owed was derived correctly from the agreed rate. The escrow pays the
/// provider that amount and refunds the balance to the depositor.
///
/// Current surface: whitelist / deposit / refund. `settle` is next.
contract SlateEscrow is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Verifier contract for the metered settlement circuit.
    /// @dev Immutable and constructor-injected rather than set by an
    /// initializer. Deploy and init would be separate transactions, and the gap
    /// between them is front-runnable: whoever calls init first chooses the
    /// verifier, and a verifier that returns true for everything drains the
    /// escrow.
    address public immutable verifier;

    /// @notice Registry holding the per-channel settlement terms.
    address public immutable registry;

    /// @notice Tokens accepted as settlement currency.
    /// @dev Owner-gated: this decides what the escrow will ever custody.
    mapping(address token => bool) public whitelisted;

    /// @notice Escrowed balance per (depositor, token), in the token's base units.
    mapping(address depositor => mapping(address token => uint256)) public balanceOf;

    event TokenWhitelisted(address indexed token);
    event Deposited(address indexed depositor, address indexed token, uint256 amount);
    event Refunded(address indexed depositor, address indexed token, uint256 amount);

    error InvalidAmount();
    error TokenNotWhitelisted();
    error NoBalanceToRefund();
    error ZeroAddress();

    constructor(address verifier_, address registry_, address owner_) Ownable(owner_) {
        if (verifier_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        verifier = verifier_;
        registry = registry_;
    }

    /// @notice Accept `token` as settlement currency. Idempotent — re-adding a
    /// token is a no-op rather than a revert, so deploy scripts stay rerunnable.
    function whitelistToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (whitelisted[token]) return;
        whitelisted[token] = true;
        emit TokenWhitelisted(token);
    }

    /// @notice Lock `amount` of `token` as escrow for the caller.
    ///
    /// @dev Credits `msg.sender` only — there is no third-party deposit, so
    /// nobody can escrow funds against someone else's channel. The pull needs a
    /// prior `approve`, which makes opening a channel approve → register →
    /// deposit.
    function deposit(address token, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (!whitelisted[token]) revert TokenNotWhitelisted();

        balanceOf[msg.sender][token] += amount;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Withdraw the caller's entire unsettled escrow for `token`.
    ///
    /// @dev Zeroes the stored balance before transferring. The whitelist admits
    /// arbitrary tokens, so a token with a transfer hook could otherwise
    /// re-enter here while the balance still reads non-zero and withdraw twice.
    function refund(address token) external {
        if (!whitelisted[token]) revert TokenNotWhitelisted();

        uint256 amount = balanceOf[msg.sender][token];
        if (amount == 0) revert NoBalanceToRefund();

        balanceOf[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Refunded(msg.sender, token, amount);
    }
}
