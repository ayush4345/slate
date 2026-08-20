// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {SlateAgentRegistry} from "../src/SlateAgentRegistry.sol";
import {SlateEscrow} from "../src/SlateEscrow.sol";

/// Deploys the settlement stack.
///
/// Order is forced: the escrow takes the verifier and registry at construction
/// and never lets them change, so both must exist first.
///
///   forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast
///
/// Env:
///   SETTLEMENT_TOKEN  ERC-20 to whitelist. Defaults to USDC for the chain,
///                     where known.
///   ESCROW_OWNER      Can whitelist further tokens. Defaults to the deployer.
contract Deploy is Script {
    /// Circle USDC. Base mainnet and Base Sepolia respectively.
    address constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        address token = vm.envOr("SETTLEMENT_TOKEN", _defaultToken());
        require(token != address(0), "set SETTLEMENT_TOKEN: no USDC default for this chain");

        vm.startBroadcast();

        address owner = vm.envOr("ESCROW_OWNER", msg.sender);

        Groth16Verifier verifier = new Groth16Verifier();
        SlateAgentRegistry registry = new SlateAgentRegistry();

        // Own it long enough to seed the whitelist, then hand it over. Taking
        // `owner` in the constructor instead would mean the deployer cannot
        // whitelist anything when the two differ.
        SlateEscrow escrow = new SlateEscrow(address(verifier), address(registry), msg.sender);
        escrow.whitelistToken(token);
        if (owner != msg.sender) escrow.transferOwnership(owner);

        vm.stopBroadcast();

        console.log("chain id          ", block.chainid);
        console.log("Groth16Verifier   ", address(verifier));
        console.log("SlateAgentRegistry", address(registry));
        console.log("SlateEscrow       ", address(escrow));
        console.log("settlement token  ", token);
        console.log("escrow owner      ", owner);
    }

    function _defaultToken() internal view returns (address) {
        if (block.chainid == 8453) return USDC_BASE;
        if (block.chainid == 84532) return USDC_BASE_SEPOLIA;
        return address(0);
    }
}
