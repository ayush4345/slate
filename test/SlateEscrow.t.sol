// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SlateEscrow} from "../src/SlateEscrow.sol";
import {SignalAddress} from "../src/SignalAddress.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// Covers the whitelist/deposit/refund surface, with emphasis on the auth
/// boundaries and the escrow-accounting invariants that protect deposited
/// funds. Settlement cases land with `settle`.
contract SlateEscrowTest is Test {
    SlateEscrow escrow;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address depositor = makeAddr("depositor");
    address attacker = makeAddr("attacker");
    address verifier = makeAddr("verifier");
    address registry = makeAddr("registry");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new SlateEscrow(verifier, registry, owner);
        vm.prank(owner);
        escrow.whitelistToken(address(usdc));
        usdc.mint(depositor, 1_000e6);
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
        assertEq(escrow.registry(), registry);
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

    function _deposit(uint256 amount) internal {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        escrow.deposit(address(usdc), amount);
        vm.stopPrank();
    }
}
