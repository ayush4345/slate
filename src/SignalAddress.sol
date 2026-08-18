// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Encodes an EVM address the way the settlement circuit's public
/// signals expect it.
///
/// The circuit binds each of depositor/provider/token as a **hi/lo pair** of
/// BN254 field elements over a 32-byte address: hi = first 16 bytes, lo = last
/// 16 bytes, both big-endian. A 20-byte EVM address is left-padded to 32 and
/// split the same way, so `hi` only ever holds the address's top 4 bytes behind
/// 12 zero bytes.
///
/// Keeping the pair (rather than collapsing an EVM address into the single
/// field element it would fit in) leaves the circuit and verifying key alone.
/// The extra signals cost a few thousand gas per settlement on an L2, which is
/// not worth a circuit change.
library SignalAddress {
    /// @dev Split a left-padded address into the circuit's (hi, lo) field pair.
    function toFieldPair(address addr) internal pure returns (uint256 hi, uint256 lo) {
        uint256 padded = uint256(uint160(addr));
        hi = padded >> 128;
        lo = padded & type(uint128).max;
    }
}
