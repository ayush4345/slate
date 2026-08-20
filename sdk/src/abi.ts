import { parseAbi } from "viem";

/**
 * The slice of each contract the client drives, written by hand rather than
 * generated. It is small enough that a hand-written list stays readable, and it
 * keeps the package independent of Foundry's build output.
 */

export const registryAbi = parseAbi([
  "function registerChannel(uint256 channelId, uint256 rateCommitment, uint256 consumerPubkeyX, uint256 consumerPubkeyY, address provider, address token)",
  "function closeChannel(uint256 channelId)",
  "function hasChannel(uint256 channelId) view returns (bool)",
  "error ChannelAlreadyRegistered()",
  "error ChannelNotFound()",
  "error ChannelNotOpen()",
  "error UnauthorizedCloser()",
  "error DepositorMismatch()",
  "error ProviderMismatch()",
  "error TokenMismatch()",
  "error RateCommitmentMismatch()",
  "error ConsumerPubkeyMismatch()",
  "error ChannelIdMismatch()",
]);

export const escrowAbi = parseAbi([
  "function deposit(address token, uint256 amount)",
  "function refund(address token)",
  "function settle(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[13] publicSignals)",
  "function balanceOf(address depositor, address token) view returns (uint256)",
  "function whitelisted(address token) view returns (bool)",
  "function verifier() view returns (address)",
  "function registry() view returns (address)",
  "error InvalidAmount()",
  "error TokenNotWhitelisted()",
  "error NoBalanceToRefund()",
  "error InvalidProof()",
  "error NullifierAlreadySpent()",
  "error SettlementExceedsEscrow()",
  "error InsufficientBalance()",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
