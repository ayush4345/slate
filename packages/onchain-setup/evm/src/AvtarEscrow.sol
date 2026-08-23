// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AvtarAgentRegistry} from "./AvtarAgentRegistry.sol";

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[13] calldata publicSignals
    ) external view returns (bool);
}

/// @title AvtarEscrow
/// @notice Holds a depositor's escrow for a metered payment channel and pays it
/// out against a single ZK settlement proof.
///
/// A channel is opened by locking escrow here. Calls are then metered entirely
/// off-chain; the channel closes when someone submits a proof that the amount
/// owed was derived correctly from the agreed rate. The escrow pays the
/// provider that amount and refunds the balance to the depositor.
///
contract AvtarEscrow is Ownable {
    using SafeERC20 for IERC20;

    uint256 internal constant N_PUBLIC = 13;

    uint256 internal constant IDX_CHANNEL_ID = 0;
    uint256 internal constant IDX_ESCROW_AMOUNT = 2;
    uint256 internal constant IDX_SETTLEMENT_AMOUNT = 3;
    uint256 internal constant IDX_NULLIFIER = 4;

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

    /// @notice Settlement nullifiers already redeemed.
    /// @dev The circuit derives one per settlement. It is what stops a valid
    /// proof from being replayed: the proof stays valid forever, so the chain
    /// has to remember that it was already paid out.
    mapping(uint256 nullifier => bool) public nullifierSpent;

    event TokenWhitelisted(address indexed token);
    event Deposited(address indexed depositor, address indexed token, uint256 amount);
    event Refunded(address indexed depositor, address indexed token, uint256 amount);
    event Settled(
        uint256 indexed channelId,
        address indexed depositor,
        address indexed provider,
        uint256 settlementAmount,
        uint256 refundAmount
    );

    error InvalidAmount();
    error TokenNotWhitelisted();
    error NoBalanceToRefund();
    error ZeroAddress();
    error InvalidProof();
    error NullifierAlreadySpent();
    error SettlementExceedsEscrow();
    error InsufficientBalance();

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

    /// @notice Close out a channel: pay the provider what the proof says is
    /// owed, return the remainder to the depositor.
    ///
    /// @dev Deliberately permissionless. The proof is the authorization — it is
    /// worthless to anyone but the parties it names, since the registry decides
    /// who gets paid and the amounts are bound into the signals. Letting anyone
    /// submit means a provider can close a channel without the depositor's
    /// cooperation, and vice versa.
    ///
    /// Order matters here: the nullifier is burned and the balance debited
    /// before either transfer, so a token that hands control back mid-transfer
    /// finds nothing left to claim.
    function settle(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[N_PUBLIC] calldata publicSignals
    ) external {
        uint256 channelId = publicSignals[IDX_CHANNEL_ID];

        // The registry owns the question of who the parties are. Taking them
        // from the caller instead would let whoever submits the proof nominate
        // the payee.
        (address depositor, address provider, address token) =
            AvtarAgentRegistry(registry).validateForSettlement(channelId, publicSignals);

        if (!whitelisted[token]) revert TokenNotWhitelisted();
        if (!IGroth16Verifier(verifier).verifyProof(a, b, c, publicSignals)) revert InvalidProof();

        uint256 escrowAmount = publicSignals[IDX_ESCROW_AMOUNT];
        uint256 settlementAmount = publicSignals[IDX_SETTLEMENT_AMOUNT];
        uint256 nullifier = publicSignals[IDX_NULLIFIER];

        if (settlementAmount > escrowAmount) revert SettlementExceedsEscrow();
        if (nullifierSpent[nullifier]) revert NullifierAlreadySpent();
        if (balanceOf[depositor][token] < escrowAmount) revert InsufficientBalance();

        nullifierSpent[nullifier] = true;
        balanceOf[depositor][token] -= escrowAmount;

        uint256 refundAmount = escrowAmount - settlementAmount;
        if (settlementAmount > 0) IERC20(token).safeTransfer(provider, settlementAmount);
        if (refundAmount > 0) IERC20(token).safeTransfer(depositor, refundAmount);

        emit Settled(channelId, depositor, provider, settlementAmount, refundAmount);
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
