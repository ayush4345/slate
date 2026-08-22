// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SlateAgentRegistry} from "../src/SlateAgentRegistry.sol";
import {SignalAddress} from "../src/SignalAddress.sol";

contract SlateAgentRegistryTest is Test {
    SlateAgentRegistry registry;

    address depositor = makeAddr("depositor");
    address provider = makeAddr("provider");
    address token = makeAddr("token");
    address stranger = makeAddr("stranger");

    uint256 constant CHANNEL_ID = 42;
    uint256 constant RATE_COMMITMENT = 0xC0FFEE;
    uint256 constant PUBKEY_X = 111;
    uint256 constant PUBKEY_Y = 222;

    function setUp() public {
        registry = new SlateAgentRegistry();
        vm.prank(depositor);
        registry.registerChannel(CHANNEL_ID, RATE_COMMITMENT, PUBKEY_X, PUBKEY_Y, provider, token);
    }

    // --- registration -------------------------------------------------------

    function test_registerChannel_recordsTerms() public view {
        SlateAgentRegistry.Channel memory channel = registry.getChannel(CHANNEL_ID);
        assertEq(channel.rateCommitment, RATE_COMMITMENT);
        assertEq(channel.consumerPubkeyX, PUBKEY_X);
        assertEq(channel.consumerPubkeyY, PUBKEY_Y);
        assertEq(channel.depositor, depositor);
        assertEq(channel.provider, provider);
        assertEq(channel.token, token);
        assertTrue(channel.open);
    }

    /// The caller is the depositor, so nobody can pin terms that spend an
    /// escrow they do not control.
    function test_registerChannel_depositorIsCaller() public {
        vm.prank(stranger);
        registry.registerChannel(99, RATE_COMMITMENT, PUBKEY_X, PUBKEY_Y, provider, token);
        assertEq(registry.getChannel(99).depositor, stranger);
    }

    /// Channel ids are bound into proofs, so reusing one would let a second set
    /// of terms claim proofs written for the first.
    function test_registerChannel_revertsOnDuplicateId() public {
        vm.prank(depositor);
        vm.expectRevert(SlateAgentRegistry.ChannelAlreadyRegistered.selector);
        registry.registerChannel(CHANNEL_ID, RATE_COMMITMENT, PUBKEY_X, PUBKEY_Y, provider, token);
    }

    function test_registerChannel_revertsOnZeroProviderOrToken() public {
        vm.startPrank(depositor);
        vm.expectRevert(SlateAgentRegistry.ZeroAddress.selector);
        registry.registerChannel(1, RATE_COMMITMENT, PUBKEY_X, PUBKEY_Y, address(0), token);
        vm.expectRevert(SlateAgentRegistry.ZeroAddress.selector);
        registry.registerChannel(2, RATE_COMMITMENT, PUBKEY_X, PUBKEY_Y, provider, address(0));
        vm.stopPrank();
    }

    function test_hasChannel() public view {
        assertTrue(registry.hasChannel(CHANNEL_ID));
        assertFalse(registry.hasChannel(CHANNEL_ID + 1));
    }

    function test_getChannel_revertsWhenMissing() public {
        vm.expectRevert(SlateAgentRegistry.ChannelNotFound.selector);
        registry.getChannel(CHANNEL_ID + 1);
    }

    // --- settlement validation ----------------------------------------------

    function test_validateForSettlement_returnsParties() public view {
        (address d, address p, address t) =
            registry.validateForSettlement(CHANNEL_ID, _signals());
        assertEq(d, depositor);
        assertEq(p, provider);
        assertEq(t, token);
    }

    function test_validateForSettlement_revertsOnChannelIdMismatch() public {
        uint256[13] memory signals = _signals();
        signals[0] = CHANNEL_ID + 1;
        vm.expectRevert(SlateAgentRegistry.ChannelIdMismatch.selector);
        registry.validateForSettlement(CHANNEL_ID, signals);
    }

    function test_validateForSettlement_revertsOnUnknownChannel() public {
        uint256[13] memory signals = _signals();
        signals[0] = 7;
        vm.expectRevert(SlateAgentRegistry.ChannelNotFound.selector);
        registry.validateForSettlement(7, signals);
    }

    /// A rate commitment that does not match is a proof about a different
    /// price than the one both sides agreed to.
    function test_validateForSettlement_revertsOnRateCommitmentMismatch() public {
        uint256[13] memory signals = _signals();
        signals[1] = RATE_COMMITMENT + 1;
        vm.expectRevert(SlateAgentRegistry.RateCommitmentMismatch.selector);
        registry.validateForSettlement(CHANNEL_ID, signals);
    }

    /// The consumer key is what the circuit checks vouchers against. A
    /// different key means somebody else authorized the spending.
    function test_validateForSettlement_revertsOnPubkeyMismatch() public {
        uint256[13] memory signals = _signals();
        signals[5] = PUBKEY_X + 1;
        vm.expectRevert(SlateAgentRegistry.ConsumerPubkeyMismatch.selector);
        registry.validateForSettlement(CHANNEL_ID, signals);

        signals = _signals();
        signals[6] = PUBKEY_Y + 1;
        vm.expectRevert(SlateAgentRegistry.ConsumerPubkeyMismatch.selector);
        registry.validateForSettlement(CHANNEL_ID, signals);
    }

    function test_validateForSettlement_revertsOnDepositorMismatch() public {
        uint256[13] memory signals = _signals();
        _writeAddress(signals, 7, 8, stranger);
        vm.expectRevert(SlateAgentRegistry.DepositorMismatch.selector);
        registry.validateForSettlement(CHANNEL_ID, signals);
    }

    /// The payee is bound into the proof; redirecting it must not validate.
    function test_validateForSettlement_revertsOnProviderMismatch() public {
        uint256[13] memory signals = _signals();
        _writeAddress(signals, 9, 10, stranger);
        vm.expectRevert(SlateAgentRegistry.ProviderMismatch.selector);
        registry.validateForSettlement(CHANNEL_ID, signals);
    }

    function test_validateForSettlement_revertsOnTokenMismatch() public {
        uint256[13] memory signals = _signals();
        _writeAddress(signals, 11, 12, stranger);
        vm.expectRevert(SlateAgentRegistry.TokenMismatch.selector);
        registry.validateForSettlement(CHANNEL_ID, signals);
    }

    /// Only the low half is wrong — the pair must be checked as a whole.
    function test_validateForSettlement_revertsOnPartialAddressMatch() public {
        uint256[13] memory signals = _signals();
        signals[8] = signals[8] + 1;
        vm.expectRevert(SlateAgentRegistry.DepositorMismatch.selector);
        registry.validateForSettlement(CHANNEL_ID, signals);
    }

    // --- closing ------------------------------------------------------------

    function test_closeChannel_byDepositor() public {
        vm.prank(depositor);
        registry.closeChannel(CHANNEL_ID);
        assertFalse(registry.getChannel(CHANNEL_ID).open);
    }

    function test_closeChannel_byProvider() public {
        vm.prank(provider);
        registry.closeChannel(CHANNEL_ID);
        assertFalse(registry.getChannel(CHANNEL_ID).open);
    }

    function test_closeChannel_revertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(SlateAgentRegistry.UnauthorizedCloser.selector);
        registry.closeChannel(CHANNEL_ID);
    }

    function test_closeChannel_revertsWhenAlreadyClosed() public {
        vm.startPrank(depositor);
        registry.closeChannel(CHANNEL_ID);
        vm.expectRevert(SlateAgentRegistry.ChannelAlreadyClosed.selector);
        registry.closeChannel(CHANNEL_ID);
        vm.stopPrank();
    }

    /// A closed channel must not settle — this is the lever either party pulls
    /// to stop further payouts.
    function test_validateForSettlement_revertsWhenClosed() public {
        vm.prank(depositor);
        registry.closeChannel(CHANNEL_ID);
        vm.expectRevert(SlateAgentRegistry.ChannelNotOpen.selector);
        registry.validateForSettlement(CHANNEL_ID, _signals());
    }

    // --- helpers ------------------------------------------------------------

    function _signals() internal view returns (uint256[13] memory signals) {
        signals[0] = CHANNEL_ID;
        signals[1] = RATE_COMMITMENT;
        signals[2] = 1_000; // escrow amount
        signals[3] = 250; // settlement amount
        signals[4] = 0xDEADBEEF; // nullifier
        signals[5] = PUBKEY_X;
        signals[6] = PUBKEY_Y;
        _writeAddress(signals, 7, 8, depositor);
        _writeAddress(signals, 9, 10, provider);
        _writeAddress(signals, 11, 12, token);
    }

    function _writeAddress(uint256[13] memory signals, uint256 hiIdx, uint256 loIdx, address addr)
        internal
        pure
    {
        (uint256 hi, uint256 lo) = SignalAddress.toFieldPair(addr);
        signals[hiIdx] = hi;
        signals[loIdx] = lo;
    }
}
