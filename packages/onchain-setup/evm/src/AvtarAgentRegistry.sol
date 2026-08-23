// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignalAddress} from "./SignalAddress.sol";

/// @title AvtarAgentRegistry
/// @notice The agreed terms of a payment channel, pinned before any metering
/// happens.
///
/// A settlement proof carries 13 public signals. Nine of them are fixed for the
/// life of a channel — who the parties are, what token they settle in, the
/// commitment to the agreed rate, and the consumer key whose vouchers the
/// circuit checks. Those are recorded here at open time, so that at settlement
/// the escrow can confirm the proof describes *this* channel rather than terms
/// invented after the fact.
///
/// The remaining four signals (escrow amount, settlement amount, nullifier, and
/// the channel id itself) vary per settlement and are supplied with the proof.
contract AvtarAgentRegistry {
    using SignalAddress for address;

    uint256 internal constant N_PUBLIC = 13;

    uint256 internal constant IDX_CHANNEL_ID = 0;
    uint256 internal constant IDX_RATE_COMMITMENT = 1;
    uint256 internal constant IDX_CONSUMER_PUBKEY_X = 5;
    uint256 internal constant IDX_CONSUMER_PUBKEY_Y = 6;
    uint256 internal constant IDX_DEPOSITOR_HI = 7;
    uint256 internal constant IDX_DEPOSITOR_LO = 8;
    uint256 internal constant IDX_PROVIDER_HI = 9;
    uint256 internal constant IDX_PROVIDER_LO = 10;
    uint256 internal constant IDX_TOKEN_HI = 11;
    uint256 internal constant IDX_TOKEN_LO = 12;

    struct Channel {
        uint256 rateCommitment;
        uint256 consumerPubkeyX;
        uint256 consumerPubkeyY;
        address depositor;
        address provider;
        address token;
        bool open;
        bool exists;
    }

    mapping(uint256 channelId => Channel) internal channels;

    event ChannelRegistered(
        uint256 indexed channelId, address indexed depositor, address indexed provider, address token
    );
    event ChannelClosed(uint256 indexed channelId, address indexed closedBy);

    error ChannelAlreadyRegistered();
    error ChannelNotFound();
    error ChannelNotOpen();
    error ChannelAlreadyClosed();
    error UnauthorizedCloser();
    error ChannelIdMismatch();
    error RateCommitmentMismatch();
    error ConsumerPubkeyMismatch();
    error DepositorMismatch();
    error ProviderMismatch();
    error TokenMismatch();
    error ZeroAddress();

    /// @notice Pin the terms of a new channel. The caller is the depositor —
    /// the party whose escrow is at stake, so nobody else can register terms
    /// that spend it.
    /// @param channelId Opaque identifier, also bound into every proof for this
    /// channel. Must be unique.
    function registerChannel(
        uint256 channelId,
        uint256 rateCommitment,
        uint256 consumerPubkeyX,
        uint256 consumerPubkeyY,
        address provider,
        address token
    ) external {
        if (channels[channelId].exists) revert ChannelAlreadyRegistered();
        if (provider == address(0) || token == address(0)) revert ZeroAddress();

        channels[channelId] = Channel({
            rateCommitment: rateCommitment,
            consumerPubkeyX: consumerPubkeyX,
            consumerPubkeyY: consumerPubkeyY,
            depositor: msg.sender,
            provider: provider,
            token: token,
            open: true,
            exists: true
        });

        emit ChannelRegistered(channelId, msg.sender, provider, token);
    }

    /// @notice The recorded terms for `channelId`.
    function getChannel(uint256 channelId) external view returns (Channel memory) {
        Channel memory channel = channels[channelId];
        if (!channel.exists) revert ChannelNotFound();
        return channel;
    }

    function hasChannel(uint256 channelId) external view returns (bool) {
        return channels[channelId].exists;
    }

    /// @notice Confirm `publicSignals` describe this channel, and hand back the
    /// parties the escrow needs to pay.
    ///
    /// @dev Called by the escrow immediately before it verifies a proof. Returning
    /// the addresses rather than having the escrow re-read them means the escrow
    /// never takes them from its caller: whoever submits the proof cannot
    /// redirect the payout, because the payee comes from what was registered here
    /// and is cross-checked against what the proof binds.
    function validateForSettlement(uint256 channelId, uint256[N_PUBLIC] calldata publicSignals)
        external
        view
        returns (address depositor, address provider, address token)
    {
        if (publicSignals[IDX_CHANNEL_ID] != channelId) revert ChannelIdMismatch();

        Channel memory channel = channels[channelId];
        if (!channel.exists) revert ChannelNotFound();
        if (!channel.open) revert ChannelNotOpen();

        if (publicSignals[IDX_RATE_COMMITMENT] != channel.rateCommitment) {
            revert RateCommitmentMismatch();
        }
        if (
            publicSignals[IDX_CONSUMER_PUBKEY_X] != channel.consumerPubkeyX
                || publicSignals[IDX_CONSUMER_PUBKEY_Y] != channel.consumerPubkeyY
        ) {
            revert ConsumerPubkeyMismatch();
        }

        if (!_matches(channel.depositor, publicSignals, IDX_DEPOSITOR_HI, IDX_DEPOSITOR_LO)) {
            revert DepositorMismatch();
        }
        if (!_matches(channel.provider, publicSignals, IDX_PROVIDER_HI, IDX_PROVIDER_LO)) {
            revert ProviderMismatch();
        }
        if (!_matches(channel.token, publicSignals, IDX_TOKEN_HI, IDX_TOKEN_LO)) {
            revert TokenMismatch();
        }

        return (channel.depositor, channel.provider, channel.token);
    }

    /// @notice Close a channel so no further settlement can be made against it.
    /// Either party may do so.
    function closeChannel(uint256 channelId) external {
        Channel storage channel = channels[channelId];
        if (!channel.exists) revert ChannelNotFound();
        if (!channel.open) revert ChannelAlreadyClosed();
        if (msg.sender != channel.depositor && msg.sender != channel.provider) {
            revert UnauthorizedCloser();
        }

        channel.open = false;
        emit ChannelClosed(channelId, msg.sender);
    }

    function _matches(
        address addr,
        uint256[N_PUBLIC] calldata publicSignals,
        uint256 hiIdx,
        uint256 loIdx
    ) private pure returns (bool) {
        (uint256 hi, uint256 lo) = addr.toFieldPair();
        return publicSignals[hiIdx] == hi && publicSignals[loIdx] == lo;
    }
}
