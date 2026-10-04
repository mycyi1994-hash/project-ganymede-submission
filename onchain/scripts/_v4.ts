/**
 * Uniswap v4 pieces shared by GanymedeRwaLiquidityHook's tests and scripts: the pool manager as
 * Uniswap built it (v4-core 1.0.2: solc 0.8.26, via IR, Cancun), the CREATE2 deployment that
 * gives the hook an address carrying its permissions, and reads of a pool's state through
 * `extsload`.
 */
import { readFileSync } from "node:fs";
import {
  concat,
  encodeAbiParameters,
  encodeDeployData,
  getAddress,
  hexToBytes,
  keccak256,
  pad,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

/**
 * Arachnid's deterministic deployment proxy. It is on X Layer Testnet (and most EVM chains);
 * calldata is the salt followed by the init code, and it deploys with CREATE2.
 */
export const CREATE2_PROXY: Address = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
export const CREATE2_PROXY_CODE: Hex =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

/**
 * The permissions GanymedeRwaLiquidityHook validates: beforeInitialize, beforeAddLiquidity,
 * beforeSwap and afterSwap. The pool manager reads a hook's permissions from the low 14 bits of
 * its address.
 */
export const RWA_HOOK_FLAGS = (1n << 13n) | (1n << 11n) | (1n << 7n) | (1n << 6n);
export const ALL_HOOK_MASK = (1n << 14n) - 1n;
export const DYNAMIC_FEE_FLAG = 0x800000;

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

type Artifact = { abi: Abi; bytecode: Hex };

/** Uniswap's v4 deployment on X Layer mainnet (developers.uniswap.org, v4 deployments). */
export const XLAYER_MAINNET_POOL_MANAGER: Address = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";

type FoundryArtifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex; immutableReferences?: Record<string, Array<{ start: number; length: number }>> };
};

function readV4Artifact(name: string): FoundryArtifact {
  const path = require.resolve(`@uniswap/v4-core/out/${name}.sol/${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as FoundryArtifact;
}

function v4Artifact(name: string): Artifact {
  const artifact = readV4Artifact(name);
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

/**
 * Whether `code` is the runtime code of v4-core 1.0.2's PoolManager, apart from its immutable
 * (the contract's own address, which NoDelegateCall keeps).
 */
export function isPoolManagerCode(code: Hex): boolean {
  const { deployedBytecode } = readV4Artifact("PoolManager");
  const expected = hexToBytes(deployedBytecode.object);
  const actual = hexToBytes(code);
  if (expected.length !== actual.length) return false;
  for (const references of Object.values(deployedBytecode.immutableReferences ?? {})) {
    for (const { start, length } of references) {
      expected.fill(0, start, start + length);
      actual.fill(0, start, start + length);
    }
  }
  return expected.every((byte, index) => byte === actual[index]);
}

/** The canonical PoolManager: constructor(address initialOwner). */
export const poolManagerArtifact = () => v4Artifact("PoolManager");
/** Uniswap's test routers, used by the tests to act as outside liquidity providers and donors. */
export const modifyLiquidityTestArtifact = () => v4Artifact("PoolModifyLiquidityTest");
export const donateTestArtifact = () => v4Artifact("PoolDonateTest");

/**
 * Finds a salt from `start` whose CREATE2 address through CREATE2_PROXY has exactly `flags` in its
 * low 14 bits. About 16,000 tries on average.
 */
export function mineSalt(initCode: Hex, flags: bigint, start = 0n): { salt: Hex; address: Address } {
  const buffer = new Uint8Array(85);
  buffer[0] = 0xff;
  buffer.set(hexToBytes(CREATE2_PROXY), 1);
  buffer.set(hexToBytes(keccak256(initCode)), 53);
  const want = Number(flags & ALL_HOOK_MASK);
  for (let candidate = start; candidate < start + 10_000_000n; candidate += 1n) {
    buffer.set(hexToBytes(pad(toHex(candidate), { size: 32 })), 21);
    const hash = keccak256(buffer, "bytes");
    if ((((hash[30] & 0x3f) << 8) | hash[31]) === want) {
      return { salt: pad(toHex(candidate), { size: 32 }), address: getAddress(toHex(hash.slice(12))) };
    }
  }
  throw new Error("no salt found");
}

export function poolIdOf(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

// PoolManager keeps `mapping(PoolId => Pool.State) _pools` at slot 6; slot0 is the state's first
// word and the in-range liquidity its fourth (StateLibrary).
const POOLS_SLOT = 6n;

export function poolStateSlot(poolId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, POOLS_SLOT]));
}

export interface Slot0 {
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
}

export function decodeSlot0(word: Hex): Slot0 {
  const value = BigInt(word);
  const rawTick = Number((value >> 160n) & 0xffffffn);
  return {
    sqrtPriceX96: value & ((1n << 160n) - 1n),
    tick: rawTick >= 0x800000 ? rawTick - 0x1000000 : rawTick,
    protocolFee: Number((value >> 184n) & 0xffffffn),
    lpFee: Number((value >> 208n) & 0xffffffn),
  };
}

const EXTSLOAD_ABI = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);

async function extsload(publicClient: PublicClient, manager: Address, slot: Hex, blockNumber?: bigint): Promise<Hex> {
  return publicClient.readContract({ address: manager, abi: EXTSLOAD_ABI, functionName: "extsload", args: [slot], blockNumber });
}

/** The pool's slot0, at the latest block or at `blockNumber`. */
export async function readSlot0(publicClient: PublicClient, manager: Address, poolId: Hex, blockNumber?: bigint): Promise<Slot0> {
  return decodeSlot0(await extsload(publicClient, manager, poolStateSlot(poolId), blockNumber));
}

/** The pool's in-range liquidity. */
export async function readLiquidity(publicClient: PublicClient, manager: Address, poolId: Hex): Promise<bigint> {
  const slot = toHex(BigInt(poolStateSlot(poolId)) + 3n, { size: 32 });
  return BigInt(await extsload(publicClient, manager, slot)) & ((1n << 128n) - 1n);
}

/** Floor of the square root of a non-negative bigint: Newton's method from a power of two above it. */
export function sqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("negative");
  if (value < 2n) return value;
  let x = 1n << BigInt((value.toString(2).length + 1) >> 1);
  for (;;) {
    const next = (x + value / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

/**
 * The pool price GanymedeRwaLiquidityHook derives from a feed answer: currency1 per currency0 in
 * base units, as a Q64.96 square root, rounded down like the contract.
 */
export function navSqrtPriceX96(answer: bigint, feedDecimals: number, assetDecimals: number, dollarDecimals: number, assetIsCurrency0: boolean): bigint {
  const navUnit = 10n ** BigInt(feedDecimals + assetDecimals);
  const dollarUnit = 10n ** BigInt(dollarDecimals);
  const priceX192 = assetIsCurrency0 ? (answer * dollarUnit * (1n << 192n)) / navUnit : (navUnit * (1n << 192n)) / (answer * dollarUnit);
  return sqrt(priceX192);
}

export interface Deployed {
  address: Address;
  hash: Hex;
  gasUsed: bigint;
}

/**
 * Deploys the RWA liquidity stack: Uniswap's PoolManager (unless `poolManager` names one), the
 * hook at a mined CREATE2 address through CREATE2_PROXY (which opens its pool at the NAV) and the
 * router. Every transaction carries its own nonce and gas limit, for load-balanced RPCs whose
 * nodes can lag the last receipt. The limits cover the gas each step used on a fork of X Layer
 * Testnet with room to spare.
 */
export async function deployRwaLiquidity(options: {
  wallet: WalletClient;
  publicClient: PublicClient;
  hookArtifact: Artifact;
  routerArtifact: Artifact;
  asset: Address;
  dollar: Address;
  feed: Address;
  name: string;
  symbol: string;
  poolManager?: Address;
  /** The first nonce to use; by default the account's pending transaction count. */
  nonce?: number;
  log?: (line: string) => void;
}): Promise<{ poolManager: Deployed | { address: Address }; hook: Deployed & { salt: Hex }; router: Deployed; nextNonce: number }> {
  const { wallet, publicClient, log = () => undefined } = options;
  const account = wallet.account!;
  let nonce = options.nonce ?? (await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }));
  async function confirm(label: string, hash: Hex): Promise<Deployed> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    log(`  ${label.padEnd(26)} ${hash}  gas ${receipt.gasUsed}`);
    return { address: receipt.contractAddress ?? "0x", hash, gasUsed: receipt.gasUsed };
  }
  async function waitForCode(address: Address) {
    for (let attempt = 0; attempt < 15 && ((await publicClient.getCode({ address })) ?? "0x") === "0x"; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }

  let poolManager: Deployed | { address: Address } = { address: options.poolManager ?? "0x" };
  if (!options.poolManager) {
    const pm = poolManagerArtifact();
    const hash = await wallet.deployContract({
      account,
      chain: wallet.chain,
      abi: pm.abi,
      bytecode: pm.bytecode,
      args: [account.address],
      nonce: nonce++,
      gas: 6_500_000n,
    });
    poolManager = await confirm("deploy PoolManager", hash);
  }
  await waitForCode(poolManager.address);

  if (((await publicClient.getCode({ address: CREATE2_PROXY })) ?? "0x") === "0x") {
    throw new Error(`No CREATE2 proxy at ${CREATE2_PROXY} on this chain.`);
  }
  const args = [poolManager.address, options.asset, options.dollar, options.feed, options.name, options.symbol] as const;
  const initCode = encodeDeployData({ abi: options.hookArtifact.abi, bytecode: options.hookArtifact.bytecode, args: args as never });
  const { salt, address: hookAddress } = mineSalt(initCode, RWA_HOOK_FLAGS);
  log(`  hook address ${hookAddress} (salt ${salt})`);
  const hookHash = await wallet.sendTransaction({
    account,
    chain: wallet.chain,
    to: CREATE2_PROXY,
    data: concat([salt, initCode]),
    nonce: nonce++,
    gas: 7_000_000n,
  });
  const hook = { ...(await confirm("deploy hook (CREATE2)", hookHash)), address: hookAddress, salt };
  await waitForCode(hookAddress);

  const routerHash = await wallet.deployContract({
    account,
    chain: wallet.chain,
    abi: options.routerArtifact.abi,
    bytecode: options.routerArtifact.bytecode,
    args: [poolManager.address],
    nonce: nonce++,
    gas: 1_500_000n,
  });
  const router = await confirm("deploy GanymedeV4Router", routerHash);
  await waitForCode(router.address);
  return { poolManager, hook, router, nextNonce: nonce };
}

/** Dollars per asset token at a pool tick, for a pool whose two tokens have the same decimals. */
export function tickToUsd(tick: number, assetIsCurrency0: boolean): number {
  const price = 1.0001 ** tick;
  return assetIsCurrency0 ? price : 1 / price;
}

/** Dollars per asset token at a pool price, for a pool whose two tokens have the same decimals. */
export function sqrtPriceToUsd(sqrtPriceX96: bigint, assetIsCurrency0: boolean): number {
  const price = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
  return assetIsCurrency0 ? price : 1 / price;
}

/**
 * Deploys GanymedeRangeLiquidityHook (positions of one's own: Spot, Curve and Bid-Ask shapes) at a
 * mined CREATE2 address on an existing PoolManager, which opens its pool at the NAV, and
 * GanymedeRangeArbitrage, which brings that pool back to the NAV through the fund. The hook needs
 * the same four permissions as GanymedeRwaLiquidityHook.
 */
export async function deployRangeLiquidity(options: {
  wallet: WalletClient;
  publicClient: PublicClient;
  hookArtifact: Artifact;
  arbitrageArtifact: Artifact;
  poolManager: Address;
  asset: Address;
  dollar: Address;
  feed: Address;
  nonce?: number;
  log?: (line: string) => void;
}): Promise<{ hook: Deployed & { salt: Hex }; arbitrage: Deployed; nextNonce: number }> {
  const { wallet, publicClient, log = () => undefined } = options;
  const account = wallet.account!;
  let nonce = options.nonce ?? (await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }));
  async function confirm(label: string, hash: Hex): Promise<Deployed> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    log(`  ${label.padEnd(26)} ${hash}  gas ${receipt.gasUsed}`);
    return { address: receipt.contractAddress ?? "0x", hash, gasUsed: receipt.gasUsed };
  }
  async function waitForCode(address: Address) {
    for (let attempt = 0; attempt < 15 && ((await publicClient.getCode({ address })) ?? "0x") === "0x"; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }
  if (((await publicClient.getCode({ address: CREATE2_PROXY })) ?? "0x") === "0x") throw new Error(`No CREATE2 proxy at ${CREATE2_PROXY} on this chain.`);
  const args = [options.poolManager, options.asset, options.dollar, options.feed] as const;
  const initCode = encodeDeployData({ abi: options.hookArtifact.abi, bytecode: options.hookArtifact.bytecode, args: args as never });
  const { salt, address: hookAddress } = mineSalt(initCode, RWA_HOOK_FLAGS);
  log(`  range hook address ${hookAddress} (salt ${salt})`);
  const hookHash = await wallet.sendTransaction({ account, chain: wallet.chain, to: CREATE2_PROXY, data: concat([salt, initCode]), nonce: nonce++, gas: 6_000_000n });
  const hook = { ...(await confirm("deploy range hook (CREATE2)", hookHash)), address: hookAddress, salt };
  await waitForCode(hookAddress);
  const arbitrageHash = await wallet.deployContract({
    account, chain: wallet.chain, abi: options.arbitrageArtifact.abi, bytecode: options.arbitrageArtifact.bytecode,
    args: [hookAddress, options.asset], nonce: nonce++, gas: 2_500_000n,
  });
  const arbitrage = await confirm("deploy GanymedeRangeArbitrage", arbitrageHash);
  await waitForCode(arbitrage.address);
  return { hook, arbitrage, nextNonce: nonce };
}
