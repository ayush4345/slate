// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SlateEscrow} from "../src/SlateEscrow.sol";
import {SlateAgentRegistry} from "../src/SlateAgentRegistry.sol";
import {SignalAddress} from "../src/SignalAddress.sol";
import {Groth16Verifier} from "../src/Verifier.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// Stands in for the generated Groth16 verifier. Proving a real settlement
/// needs the circuit and a witness, which is what the end-to-end run against a
/// live node covers; these tests are about what the escrow does with the
/// verifier's answer, so the answer itself is dialled directly.
contract StubVerifier {
    bool public accepts = true;

    function setAccepts(bool value) external {
        accepts = value;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[13] calldata)
        external
        view
        returns (bool)
    {
        return accepts;
    }
}

/// An ERC-20 that calls back into the escrow when it pays out, standing in for
/// a token with transfer hooks.
contract ReentrantToken is ERC20 {
    SlateEscrow escrow;
    bool attacking;

    constructor() ERC20("Reentrant", "RE") {}

    function setEscrow(SlateEscrow escrow_) external {
        escrow = escrow_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (address(escrow) != address(0) && from == address(escrow) && !attacking) {
            attacking = true;
            try escrow.refund(address(this)) {} catch {}
            attacking = false;
        }
    }
}

/// Covers the whitelist/deposit/refund/settle surface, with emphasis on the
/// auth boundaries and the escrow-accounting invariants that protect deposited
/// funds.
contract SlateEscrowTest is Test {
    SlateEscrow escrow;
    SlateAgentRegistry registry;
    StubVerifier verifierContract;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address depositor = makeAddr("depositor");
    address attacker = makeAddr("attacker");
    address provider = makeAddr("provider");

    address verifier;

    uint256 constant CHANNEL_ID = 42;
    uint256 constant RATE_COMMITMENT = 0xC0FFEE;
    uint256 constant PUBKEY_X = 111;
    uint256 constant PUBKEY_Y = 222;
    uint256 constant NULLIFIER = 0xDEADBEEF;

    uint256[2] emptyA;
    uint256[2][2] emptyB;
    uint256[2] emptyC;

    function setUp() public {
        usdc = new MockUSDC();
        registry = new SlateAgentRegistry();
        verifierContract = new StubVerifier();
        verifier = address(verifierContract);

        escrow = new SlateEscrow(verifier, address(registry), owner);
        vm.prank(owner);
        escrow.whitelistToken(address(usdc));
        usdc.mint(depositor, 1_000e6);

        vm.prank(depositor);
        registry.registerChannel(
            CHANNEL_ID, RATE_COMMITMENT, PUBKEY_X, PUBKEY_Y, provider, address(usdc)
        );
    }

    // --- auth boundaries ----------------------------------------------------

    /// The whitelist decides what the escrow will custody, so it must be closed.
    function test_whitelistToken_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        escrow.whitelistToken(makeAddr("fakeToken"));
    }

    /// Verifier and registry are fixed at construction, so there is no
    /// post-deploy window in which anyone can point the escrow elsewhere.
    function test_verifierIsImmutable() public view {
        assertEq(escrow.verifier(), verifier);
        assertEq(escrow.registry(), address(registry));
    }

    /// The escrow pulls funds, so a deposit without a prior approve must fail
    /// loudly rather than credit a balance it never received.
    function test_deposit_revertsWithoutApproval() public {
        vm.prank(depositor);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(escrow), 0, 100e6)
        );
        escrow.deposit(address(usdc), 100e6);
    }

    /// Balance is cleared before the transfer, so a token with a transfer hook
    /// cannot re-enter and withdraw twice.
    function test_refund_zeroesBalanceBeforeTransfer() public {
        _deposit(100e6);

        vm.prank(depositor);
        escrow.refund(address(usdc));

        assertEq(escrow.balanceOf(depositor, address(usdc)), 0);
        assertEq(usdc.balanceOf(depositor), 1_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // --- escrow accounting --------------------------------------------------

    function test_deposit_creditsBalance() public {
        _deposit(100e6);
        assertEq(escrow.balanceOf(depositor, address(usdc)), 100e6);
        assertEq(usdc.balanceOf(address(escrow)), 100e6);
    }

    function test_deposit_accumulates() public {
        _deposit(100e6);
        _deposit(50e6);
        assertEq(escrow.balanceOf(depositor, address(usdc)), 150e6);
    }

    function test_deposit_revertsOnZeroAmount() public {
        vm.prank(depositor);
        vm.expectRevert(SlateEscrow.InvalidAmount.selector);
        escrow.deposit(address(usdc), 0);
    }

    function test_deposit_revertsOnUnwhitelistedToken() public {
        MockUSDC other = new MockUSDC();
        other.mint(depositor, 100e6);
        vm.startPrank(depositor);
        other.approve(address(escrow), 100e6);
        vm.expectRevert(SlateEscrow.TokenNotWhitelisted.selector);
        escrow.deposit(address(other), 100e6);
        vm.stopPrank();
    }

    function test_refund_revertsOnEmptyBalance() public {
        vm.prank(depositor);
        vm.expectRevert(SlateEscrow.NoBalanceToRefund.selector);
        escrow.refund(address(usdc));
    }

    function test_whitelistToken_isIdempotent() public {
        vm.startPrank(owner);
        escrow.whitelistToken(address(usdc));
        vm.stopPrank();
        assertTrue(escrow.whitelisted(address(usdc)));
    }

    // --- circuit encoding ---------------------------------------------------

    /// A left-padded EVM address must split into the same (hi, lo) pair the
    /// circuit binds: hi = first 16 bytes, lo = last 16 bytes, big-endian.
    function testFuzz_signalAddress_roundTrips(address addr) public pure {
        (uint256 hi, uint256 lo) = SignalAddress.toFieldPair(addr);
        bytes32 padded = bytes32(uint256(uint160(addr)));
        assertEq(hi, uint256(uint128(bytes16(padded))));
        assertEq(lo, uint256(uint128(uint256(padded))));
        assertEq(address(uint160((hi << 128) | lo)), addr);
    }

    // --- settlement ---------------------------------------------------------

    function test_settle_paysProviderAndRefundsRemainder() public {
        _deposit(1_000);

        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));

        assertEq(usdc.balanceOf(provider), 250, "provider paid");
        assertEq(usdc.balanceOf(depositor), 1_000e6 - 1_000 + 750, "remainder refunded");
        assertEq(escrow.balanceOf(depositor, address(usdc)), 0, "escrow released");
        assertEq(usdc.balanceOf(address(escrow)), 0, "nothing stranded");
    }

    /// Anyone may submit; the proof and the registry decide the outcome, not
    /// the sender. This is what lets a provider close a channel unilaterally.
    function test_settle_isPermissionless() public {
        _deposit(1_000);
        vm.prank(attacker);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
        assertEq(usdc.balanceOf(provider), 250);
    }

    /// The payee comes from the registry, so a submitter cannot redirect funds
    /// by naming themselves anywhere in the call.
    function test_settle_payeeComesFromRegistry() public {
        _deposit(1_000);
        vm.prank(attacker);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_settle_revertsOnInvalidProof() public {
        _deposit(1_000);
        verifierContract.setAccepts(false);
        vm.expectRevert(SlateEscrow.InvalidProof.selector);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
    }

    /// A proof stays valid forever, so the nullifier is the only thing standing
    /// between one settlement and unlimited replays of it.
    function test_settle_revertsOnReplayedNullifier() public {
        _deposit(2_000);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
        vm.expectRevert(SlateEscrow.NullifierAlreadySpent.selector);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
    }

    /// Distinct nullifiers are allowed, but each draws real escrow — so the
    /// balance, not the nullifier, caps total payout.
    function test_settle_secondSettlementNeedsItsOwnEscrow() public {
        _deposit(1_000);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
        vm.expectRevert(SlateEscrow.InsufficientBalance.selector);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER + 1));
    }

    function test_settle_revertsWhenSettlementExceedsEscrow() public {
        _deposit(1_000);
        vm.expectRevert(SlateEscrow.SettlementExceedsEscrow.selector);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 1_001, NULLIFIER));
    }

    function test_settle_revertsWhenEscrowUnderfunded() public {
        _deposit(500);
        vm.expectRevert(SlateEscrow.InsufficientBalance.selector);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
    }

    /// Either party closing the channel stops settlement, even with a proof in
    /// hand.
    function test_settle_revertsOnClosedChannel() public {
        _deposit(1_000);
        vm.prank(provider);
        registry.closeChannel(CHANNEL_ID);
        vm.expectRevert(SlateAgentRegistry.ChannelNotOpen.selector);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
    }

    function test_settle_revertsOnUnknownChannel() public {
        _deposit(1_000);
        uint256[13] memory signals = _signals(1_000, 250, NULLIFIER);
        signals[0] = CHANNEL_ID + 1;
        vm.expectRevert(SlateAgentRegistry.ChannelNotFound.selector);
        escrow.settle(emptyA, emptyB, emptyC, signals);
    }

    /// Full payout with nothing owed back, and the zero-refund branch.
    function test_settle_wholeEscrowToProvider() public {
        _deposit(1_000);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 1_000, NULLIFIER));
        assertEq(usdc.balanceOf(provider), 1_000);
        assertEq(usdc.balanceOf(depositor), 1_000e6 - 1_000);
    }

    /// Zero owed: the depositor gets everything back, and the zero-payment
    /// branch must not transfer.
    function test_settle_zeroSettlementRefundsEverything() public {
        _deposit(1_000);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 0, NULLIFIER));
        assertEq(usdc.balanceOf(provider), 0);
        assertEq(usdc.balanceOf(depositor), 1_000e6);
    }

    /// Settling releases exactly the escrow the proof names, leaving the rest
    /// of the depositor's balance withdrawable.
    function test_settle_leavesSurplusRefundable() public {
        _deposit(1_500);
        escrow.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
        assertEq(escrow.balanceOf(depositor, address(usdc)), 500);

        vm.prank(depositor);
        escrow.refund(address(usdc));
        assertEq(escrow.balanceOf(depositor, address(usdc)), 0);
        assertEq(usdc.balanceOf(depositor), 1_000e6 - 250);
    }

    /// Wires the real generated verifier rather than the stub, so a drift
    /// between its ABI and the interface the escrow calls through shows up
    /// here instead of on a live network. A junk proof must be rejected, not
    /// accepted and not swallowed.
    function test_settle_againstGeneratedVerifier() public {
        SlateEscrow real = new SlateEscrow(address(new Groth16Verifier()), address(registry), owner);
        vm.prank(owner);
        real.whitelistToken(address(usdc));

        vm.startPrank(depositor);
        usdc.approve(address(real), 1_000);
        real.deposit(address(usdc), 1_000);
        vm.stopPrank();

        vm.expectRevert(SlateEscrow.InvalidProof.selector);
        real.settle(emptyA, emptyB, emptyC, _signals(1_000, 250, NULLIFIER));
    }

    // --- reentrancy ---------------------------------------------------------

    /// A token that calls back on transfer must not be able to withdraw twice:
    /// the balance is already zero by the time it regains control.
    function test_refund_resistsReentrantToken() public {
        ReentrantToken evil = new ReentrantToken();
        evil.setEscrow(escrow);
        vm.prank(owner);
        escrow.whitelistToken(address(evil));

        evil.mint(depositor, 1_000);
        vm.startPrank(depositor);
        evil.approve(address(escrow), 1_000);
        escrow.deposit(address(evil), 1_000);
        escrow.refund(address(evil));
        vm.stopPrank();

        assertEq(evil.balanceOf(depositor), 1_000, "withdrew exactly once");
        assertEq(evil.balanceOf(address(escrow)), 0);
        assertEq(escrow.balanceOf(depositor, address(evil)), 0);
    }

    // --- helpers ------------------------------------------------------------

    function _signals(uint256 escrowAmount, uint256 settlementAmount, uint256 nullifier)
        internal
        view
        returns (uint256[13] memory signals)
    {
        signals[0] = CHANNEL_ID;
        signals[1] = RATE_COMMITMENT;
        signals[2] = escrowAmount;
        signals[3] = settlementAmount;
        signals[4] = nullifier;
        signals[5] = PUBKEY_X;
        signals[6] = PUBKEY_Y;
        (signals[7], signals[8]) = SignalAddress.toFieldPair(depositor);
        (signals[9], signals[10]) = SignalAddress.toFieldPair(provider);
        (signals[11], signals[12]) = SignalAddress.toFieldPair(address(usdc));
    }

    function _deposit(uint256 amount) internal {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        escrow.deposit(address(usdc), amount);
        vm.stopPrank();
    }
}
