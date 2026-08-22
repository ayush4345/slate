// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {SlateAgentRegistry} from "../src/SlateAgentRegistry.sol";
import {SlateEscrow} from "../src/SlateEscrow.sol";

/// 6-decimal stand-in for USDC, so anvil runs do not need a predeployed token.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Deploy the settlement stack onto a local anvil, with a minted mock USDC.
///
///   anvil
///   forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 \
///     --broadcast --private-key <anvil-account-0>
contract DeployLocal is Script {
    uint256 internal constant INITIAL_MINT = 1_000_000e6;

    function run() external {
        vm.startBroadcast();

        MockUSDC token = new MockUSDC();
        Groth16Verifier verifier = new Groth16Verifier();
        SlateAgentRegistry registry = new SlateAgentRegistry();
        SlateEscrow escrow = new SlateEscrow(address(verifier), address(registry), msg.sender);
        escrow.whitelistToken(address(token));
        token.mint(msg.sender, INITIAL_MINT);

        vm.stopBroadcast();

        console.log("chain id          ", block.chainid);
        console.log("MockUSDC          ", address(token));
        console.log("Groth16Verifier   ", address(verifier));
        console.log("SlateAgentRegistry", address(registry));
        console.log("SlateEscrow       ", address(escrow));
        console.log("escrow owner      ", msg.sender);
    }
}
