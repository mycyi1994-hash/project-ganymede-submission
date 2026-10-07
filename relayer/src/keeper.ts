import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, maxUint256, parseAbi, parseAbiParameters,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xlayerTestnet } from "./chain";
import { nonceCounts, outbidFees, type Fees } from "./fees";

/**
 * The USTX arbitrage keeper, a Worker of its own (wrangler.keeper.jsonc). Every five minutes it
 * asks GanymedeNavArbitrage for the trade that closes the USTX pool's gap to the NAV and, when that
 * trade earns at least a cent, sends it from its own wallet. That keeps the pool's market price
 * near the NAV, the way ETF creation and redemption do for a fund.
 *
 * It runs three minutes past each five-minute mark, after the app's NAV record for that mark has
 * landed, and runs every trade as a call before sending it, so it does not pay gas for a trade
 * that would revert. With V4_HOOK_ADDRESS set, it also moves the Uniswap v4 pool to each new NAV
 * record, which turns the deposits waiting for that record into LP tokens; with RANGE_ARBITRAGE_ADDRESS
 * set, it brings the pool of one's own positions to the NAV through the fund, which needs no money
 * beyond, at times, the rest of the fund's $10 minimum investment, repaid in USTX. Its key (KEEPER_PRIVATE_KEY, a Worker secret) holds testnet OKB for gas and
 * no-value demo dollars, claimed from the demo dollar when it runs low. It has no role on any
 * contract, and a trade that is no longer profitable when it lands reverts in the arbitrage contract.
 */

export interface KeeperEnv {
  KEEPER_PRIVATE_KEY?: string;
  ARBITRAGE_ADDRESS?: string;
  DOLLAR_ADDRESS?: string;
  SETTLEMENT_RPC_URL?: string;
  /** GanymedeRwaLiquidityHook once it is deployed: the keeper then moves its Uniswap v4 pool to each NAV record. */
  V4_HOOK_ADDRESS?: string;
  /** GanymedeRangeArbitrage once the pool of one's own positions is deployed: the keeper then brings that pool to the NAV. */
  RANGE_ARBITRAGE_ADDRESS?: string;
}

/** The least a trade must earn to be worth sending, in demo-dollar micros: a cent. */
export const MIN_PROFIT_MICROS = 10_000n;
// The fund refuses investments under $10, and a claim adds 10,000 demo dollars.
const MIN_INVESTMENT_MICROS = 10_000_000n;
const CLAIM_MICROS = 10_000_000_000n;

export type Quote = { buyInPool: boolean; dollarsIn: bigint; dollarsOut: bigint };
export type Sent = { hash: Hex; success: boolean };
export type Simulation = { dollarsOut: bigint } | { revert: string };

/** The Uniswap v4 pool's side: the NAV record the hook would use now and the one its pool is centred on, and the move between them. */
export interface RepegChain {
  /** updatedAt of the NAV the hook would use now (null while it cannot use one) and of the record the pool is centred on. */
  pegState(): Promise<{ navUpdatedAt: bigint | null; peggedAt: bigint }>;
  /** Runs repeg() as a call on the latest block: whether it would move the pool, or the error it would revert with. */
  simulateRepeg(): Promise<{ repegged: boolean } | { revert: string }>;
  repeg(): Promise<Sent>;
}

/**
 * The pool of one's own positions: its arbitrage needs no money, so the keeper only runs it as a call
 * and sends it when it pays. Where the pool pays less than the fund needs (selling into under the
 * fund's $10 minimum investment), the arbitrage draws the rest from the keeper's demo dollars and
 * repays it in USTX worth more at the NAV, so it needs the keeper's allowance.
 */
export interface RangeChain {
  /** The keeper's demo-dollar allowance to the arbitrage, and approving it in full. */
  dollarAllowance(): Promise<bigint>;
  approveDollars(): Promise<Sent>;
  /** The arbitrage's profit in demo-dollar micros, run as a call, or the error it would revert with. */
  simulate(): Promise<{ profit: bigint } | { revert: string }>;
  /** USTX's price in the pool against the NAV, as a fraction (−0.012 is 1.2% under it); null while the hook has no usable NAV. */
  navGap(): Promise<number | null>;
  arbitrage(minProfit: bigint): Promise<Sent>;
}

/**
 * How far the range pool's price may be from the NAV for positions to open: the hook allows
 * OPEN_TICKS, about 1%, and the app (app/product-ui/Pools.tsx) stops short of it at 0.95%.
 */
export const RANGE_OPEN_GAP = 0.0095;

export type RangeOutcome = { action: "none"; reason: string } | { action: "arbitrage" | "recentre"; profit: string; hash: Hex; success: boolean };

/**
 * Brings the range pool to the NAV when that earns at least a cent, insisting on half of it when it
 * lands. A profit of exactly 0 means no position lies between the price and the NAV, and the trade
 * only moves the price across that empty stretch, which positions need before they can open; or that
 * the pool pays less than the fund's minimum, and the keeper's demo dollars make up the rest for USTX
 * worth more at the NAV. Either is sent for the gas alone. A profit under a cent means only a little
 * liquidity lies there; that trade is sent too, insisting on half of it, while the price is too far
 * from the NAV for positions to open, since nothing else would bring it back. The keeper approves
 * its demo dollars to the arbitrage first, once, and keeps the $10 it may draw: given its `wallet`,
 * it claims demo dollars when it holds less and a claim is due, whatever became of the other trade.
 */
export async function runRangeArbitrage(chain: RangeChain, wallet?: KeeperWallet): Promise<RangeOutcome> {
  if (wallet && (await wallet.dollarBalance()) < MIN_INVESTMENT_MICROS && (await wallet.nextClaimAt()) <= (await wallet.now())) {
    const claimed = await wallet.claim();
    if (!claimed.success) return none(`claim reverted: ${claimed.hash}`);
  }
  if (await chain.dollarAllowance() < MIN_INVESTMENT_MICROS) {
    const approved = await chain.approveDollars();
    if (!approved.success) return none(`approving demo dollars for the range arbitrage failed in ${approved.hash}`);
  }
  const simulated = await chain.simulate();
  if ("revert" in simulated) return none(simulated.revert.startsWith("NothingToDo") ? "the range pool is within its fee of the NAV" : `the arbitrage would revert: ${simulated.revert}`);
  if (simulated.profit === 0n) {
    const sent = await chain.arbitrage(0n);
    return { action: "recentre", profit: "0", hash: sent.hash, success: sent.success };
  }
  if (simulated.profit < MIN_PROFIT_MICROS) {
    const gap = await chain.navGap();
    if (gap === null || Math.abs(gap) <= RANGE_OPEN_GAP) return none(`the arbitrage would earn ${simulated.profit}, under the ${MIN_PROFIT_MICROS} worth a trade`);
    const sent = await chain.arbitrage(simulated.profit / 2n);
    return { action: "recentre", profit: simulated.profit.toString(), hash: sent.hash, success: sent.success };
  }
  const sent = await chain.arbitrage(simulated.profit / 2n);
  return { action: "arbitrage", profit: simulated.profit.toString(), hash: sent.hash, success: sent.success };
}

export type RepegOutcome = { action: "none"; reason: string } | { action: "repeg"; navUpdatedAt: string; hash: Hex; success: boolean };

/**
 * Moves the v4 pool to a NAV record it has not used yet. That converts the deposits waiting for the
 * record into LP tokens at once; otherwise the next swap or deposit does it, and a trader pays the gas.
 */
export async function runRepeg(chain: RepegChain): Promise<RepegOutcome> {
  const { navUpdatedAt, peggedAt } = await chain.pegState();
  if (navUpdatedAt === null) return none("no usable NAV for the v4 pool");
  if (navUpdatedAt <= peggedAt) return none("the v4 pool is at the latest NAV record");
  const simulated = await chain.simulateRepeg();
  if ("revert" in simulated) return none(`the re-peg would revert: ${simulated.revert}`);
  if (!simulated.repegged) return none("the v4 pool is at the latest NAV record");
  const sent = await chain.repeg();
  return { action: "repeg", navUpdatedAt: navUpdatedAt.toString(), hash: sent.hash, success: sent.success };
}

/** What the keeper reads and sends. The Worker binds it to X Layer Testnet; tests use a fake. */
export interface KeeperChain {
  quote(): Promise<Quote>;
  dollarBalance(): Promise<bigint>;
  allowance(): Promise<bigint>;
  nextClaimAt(): Promise<bigint>;
  now(): Promise<bigint>;
  /** Runs the trade as a call on the latest block, insisting only on no loss, without sending it. */
  simulate(buyInPool: boolean, dollarsIn: bigint): Promise<Simulation>;
  claim(): Promise<Sent>;
  approve(): Promise<Sent>;
  arbitrage(buyInPool: boolean, dollarsIn: bigint, minProfit: bigint): Promise<Sent>;
  /** The v4 pool, when V4_HOOK_ADDRESS is set; it shares the keeper's nonces. */
  v4?: RepegChain | null;
  /** The range pool, when RANGE_ARBITRAGE_ADDRESS is set; it shares the keeper's nonces too. */
  range?: RangeChain | null;
}

/** The keeper's own demo dollars, for the range pool's arbitrage to keep enough of them. */
export type KeeperWallet = Pick<KeeperChain, "dollarBalance" | "nextClaimAt" | "now" | "claim">;

export type KeeperOutcome =
  | { action: "none"; reason: string }
  | { action: "arbitrage"; direction: "buyAndRedeem" | "investAndSell"; dollarsIn: string; expectedOut: string; hash: Hex; success: boolean };

export async function runKeeper(chain: KeeperChain): Promise<KeeperOutcome> {
  let quote = await quoteOrReason(chain);
  if (typeof quote === "string") return none(quote);

  let balance = await chain.dollarBalance();
  let wrote = false;
  if (balance < quote.dollarsIn && (await chain.nextClaimAt()) <= (await chain.now())) {
    const claimed = await chain.claim();
    if (!claimed.success) return none(`claim reverted: ${claimed.hash}`);
    balance += CLAIM_MICROS;
    wrote = true;
  }
  if (balance > 0n && (await chain.allowance()) < balance) {
    const approved = await chain.approve();
    if (!approved.success) return none(`approve reverted: ${approved.hash}`);
    wrote = true;
  }
  // Claiming and approving take a few blocks, and the pool or the NAV can move meanwhile.
  if (wrote) {
    quote = await quoteOrReason(chain);
    if (typeof quote === "string") return none(quote);
  }

  const size = balance < quote.dollarsIn ? balance : quote.dollarsIn;
  if (size === 0n || (!quote.buyInPool && size < MIN_INVESTMENT_MICROS)) {
    return none(`holds ${balance} demo-dollar micros, too few for the trade`);
  }
  // A trade that would revert still costs gas, so run it as a call first; the call also gives the
  // exact demo dollars back at this size.
  const simulated = await chain.simulate(quote.buyInPool, size);
  if ("revert" in simulated) return none(`the trade would revert: ${simulated.revert}`);
  const profit = simulated.dollarsOut - size;
  if (profit < MIN_PROFIT_MICROS) return none(`a trade of ${size} demo-dollar micros would earn ${profit}, under the ${MIN_PROFIT_MICROS} worth a trade`);
  // Insist on half that profit, so a trade that lands after the pool or the NAV has moved reverts
  // instead of losing.
  const sent = await chain.arbitrage(quote.buyInPool, size, profit / 2n);
  return {
    action: "arbitrage",
    direction: quote.buyInPool ? "buyAndRedeem" : "investAndSell",
    dollarsIn: size.toString(),
    expectedOut: simulated.dollarsOut.toString(),
    hash: sent.hash,
    success: sent.success,
  };
}

/** The quote when closing the gap is worth a trade, or why it is not. */
async function quoteOrReason(chain: KeeperChain): Promise<Quote | string> {
  let quote: Quote;
  try {
    quote = await chain.quote();
  } catch (error) {
    // For example NavTooOld: without a usable NAV there is no gap to close.
    return `no quote: ${describe(error)}`;
  }
  if (quote.dollarsIn === 0n) return "the pool is within its fee of the NAV";
  const profit = quote.dollarsOut - quote.dollarsIn;
  if (profit < MIN_PROFIT_MICROS) return `closing the gap would earn ${profit} demo-dollar micros, under the ${MIN_PROFIT_MICROS} worth a trade`;
  return quote;
}

function none(reason: string): { action: "none"; reason: string } {
  return { action: "none", reason };
}

const ARBITRAGE_ABI = parseAbi([
  "function quote() view returns (bool buyInPool, uint256 dollarsIn, uint256 dollarsOut)",
  "function buyAndRedeem(uint256 dollarsIn, uint256 minProfit) returns (uint256)",
  "function investAndSell(uint256 dollarsIn, uint256 minProfit) returns (uint256)",
  // Its own errors and those the fund, the pool and the demo dollar pass up through it.
  "error Unprofitable(uint256 dollarsIn, uint256 dollarsOut)",
  "error TransferFailed()",
  "error InvalidAmount()",
  "error BelowMinimum()",
  "error NavUnavailable()",
  "error NavTooOld(uint64 effectiveAt)",
  "error SlippageExceeded()",
  "error InsufficientBalance()",
  "error InsufficientAllowance()",
  "error InsufficientLiquidity()",
  "error ContractPaused()",
  "error Expired()",
]);

const HOOK_ABI = parseAbi([
  "function nav() view returns (uint256 answer, uint256 updatedAt, uint160 sqrtPriceX96)",
  "function peggedAt() view returns (uint256)",
  "function repeg() returns (bool)",
  "error NavUnavailable()",
  "error NavTooOld(uint256 updatedAt)",
  "error NavInFuture(uint256 updatedAt)",
  "error NavOutOfRange()",
  "error Reentrancy()",
]);

const RANGE_ARBITRAGE_ABI = parseAbi([
  "function arbitrage(uint256 minProfit) returns (uint256 profit)",
  "function hook() view returns (address)",
  "function poolManager() view returns (address)",
  "error NothingToDo()",
  "error Unprofitable(uint256 profit)",
  "error TransferFailed()",
  "error NavUnavailable()",
  "error NavTooOld(uint256 updatedAt)",
  "error NavInFuture(uint256 updatedAt)",
  "error OutsideBand(int24 tick, int24 navTick)",
  "error BelowMinimum()",
  "error ContractPaused()",
  "error InsufficientAllowance()",
  "error InsufficientBalance()",
]);

const RANGE_HOOK_ABI = parseAbi([
  "function poolId() view returns (bytes32)",
  "function assetIsCurrency0() view returns (bool)",
  "function nav() view returns (uint256 answer, uint256 updatedAt, uint160 sqrtPriceX96)",
  "error NavUnavailable()",
  "error NavTooOld(uint256 updatedAt)",
  "error NavInFuture(uint256 updatedAt)",
  "error NavOutOfRange()",
]);

const POOL_MANAGER_ABI = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);
// Where Uniswap v4's PoolManager keeps its pools (StateLibrary.POOLS_SLOT): a pool's slot0 is at keccak256(poolId, 6).
const POOLS_SLOT = 6n;

const DOLLAR_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function nextClaimAt(address account) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function claim()",
]);

const isAddress = (value: string | undefined): value is Address => Boolean(value && /^0x[0-9a-fA-F]{40}$/.test(value));

function address(value: string | undefined, name: string): Address {
  if (!value) throw new Error(`${name} is not set.`);
  if (!isAddress(value)) throw new Error(`${name} is not an address.`);
  return value;
}

/** The keeper's chain on X Layer Testnet, signing with KEEPER_PRIVATE_KEY. */
export function xlayerKeeperChain(env: KeeperEnv): KeeperChain {
  const key = env.KEEPER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("KEEPER_PRIVATE_KEY is not set.");
  const arbitrage = address(env.ARBITRAGE_ADDRESS, "ARBITRAGE_ADDRESS");
  const dollar = address(env.DOLLAR_ADDRESS, "DOLLAR_ADDRESS");
  // The v4 pool is optional: a malformed hook address is reported on each run without stopping the arbitrage.
  const hook = isAddress(env.V4_HOOK_ADDRESS) ? env.V4_HOOK_ADDRESS : null;
  if (env.V4_HOOK_ADDRESS && !hook) console.error("V4_HOOK_ADDRESS is not an address; the v4 pool is not re-pegged.");
  const rangeArbitrage = isAddress(env.RANGE_ARBITRAGE_ADDRESS) ? env.RANGE_ARBITRAGE_ADDRESS : null;
  if (env.RANGE_ARBITRAGE_ADDRESS && !rangeArbitrage) console.error("RANGE_ARBITRAGE_ADDRESS is not an address; the range pool is not arbitraged.");
  const account = privateKeyToAccount(key as Hex);
  const transport = http(env.SETTLEMENT_RPC_URL || xlayerTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: xlayerTestnet, transport });
  const walletClient = createWalletClient({ chain: xlayerTestnet, transport, account });
  const send = nonceSender(publicClient, account.address);

  return {
    async quote() {
      const [buyInPool, dollarsIn, dollarsOut] = await publicClient.readContract({ address: arbitrage, abi: ARBITRAGE_ABI, functionName: "quote" });
      return { buyInPool, dollarsIn, dollarsOut };
    },
    dollarBalance: () => publicClient.readContract({ address: dollar, abi: DOLLAR_ABI, functionName: "balanceOf", args: [account.address] }),
    allowance: () => publicClient.readContract({ address: dollar, abi: DOLLAR_ABI, functionName: "allowance", args: [account.address, arbitrage] }),
    nextClaimAt: () => publicClient.readContract({ address: dollar, abi: DOLLAR_ABI, functionName: "nextClaimAt", args: [account.address] }),
    now: async () => (await publicClient.getBlock()).timestamp,
    async simulate(buyInPool, dollarsIn) {
      try {
        const { result } = await publicClient.simulateContract({
          account,
          address: arbitrage,
          abi: ARBITRAGE_ABI,
          functionName: buyInPool ? "buyAndRedeem" : "investAndSell",
          args: [dollarsIn, 0n],
        });
        return { dollarsOut: result };
      } catch (error) {
        const reason = revertReason(error);
        if (reason === undefined) throw error;
        return { revert: reason };
      }
    },
    claim: () => send((n, fees) => walletClient.writeContract({ address: dollar, abi: DOLLAR_ABI, functionName: "claim", nonce: n, ...fees, gas: 150_000n })),
    approve: () => send((n, fees) => walletClient.writeContract({ address: dollar, abi: DOLLAR_ABI, functionName: "approve", args: [arbitrage, maxUint256], nonce: n, ...fees, gas: 80_000n })),
    arbitrage: (buyInPool, dollarsIn, minProfit) =>
      send((n, fees) => walletClient.writeContract({
        address: arbitrage,
        abi: ARBITRAGE_ABI,
        functionName: buyInPool ? "buyAndRedeem" : "investAndSell",
        args: [dollarsIn, minProfit],
        nonce: n,
        ...fees,
        gas: 400_000n,
      })),
    v4: hook && {
      async pegState() {
        const peggedAt = await publicClient.readContract({ address: hook, abi: HOOK_ABI, functionName: "peggedAt" });
        try {
          const [, updatedAt] = await publicClient.readContract({ address: hook, abi: HOOK_ABI, functionName: "nav" });
          return { navUpdatedAt: updatedAt, peggedAt };
        } catch (error) {
          // A missing, stale or future-dated NAV: the hook would not move the pool to it.
          if (revertReason(error) === undefined) throw error;
          return { navUpdatedAt: null, peggedAt };
        }
      },
      async simulateRepeg() {
        try {
          const { result } = await publicClient.simulateContract({ account, address: hook, abi: HOOK_ABI, functionName: "repeg" });
          return { repegged: result };
        } catch (error) {
          const reason = revertReason(error);
          if (reason === undefined) throw error;
          return { revert: reason };
        }
      },
      // Removing both ranges, moving the empty pool and adding them back: about 500,000 gas.
      repeg: () => send((n, fees) => walletClient.writeContract({ address: hook, abi: HOOK_ABI, functionName: "repeg", nonce: n, ...fees, gas: 900_000n })),
    },
    range: rangeArbitrage && {
      dollarAllowance: () => publicClient.readContract({ address: dollar, abi: DOLLAR_ABI, functionName: "allowance", args: [account.address, rangeArbitrage] }),
      approveDollars: () => send((n, fees) => walletClient.writeContract({ address: dollar, abi: DOLLAR_ABI, functionName: "approve", args: [rangeArbitrage, maxUint256], nonce: n, ...fees, gas: 80_000n })),
      async simulate() {
        try {
          const { result } = await publicClient.simulateContract({ account, address: rangeArbitrage, abi: RANGE_ARBITRAGE_ABI, functionName: "arbitrage", args: [0n] });
          return { profit: result };
        } catch (error) {
          const reason = revertReason(error);
          if (reason === undefined) throw error;
          return { revert: reason };
        }
      },
      async navGap() {
        const [hook, manager] = await Promise.all([
          publicClient.readContract({ address: rangeArbitrage, abi: RANGE_ARBITRAGE_ABI, functionName: "hook" }),
          publicClient.readContract({ address: rangeArbitrage, abi: RANGE_ARBITRAGE_ABI, functionName: "poolManager" }),
        ]);
        const [poolId, assetIsCurrency0] = await Promise.all([
          publicClient.readContract({ address: hook, abi: RANGE_HOOK_ABI, functionName: "poolId" }),
          publicClient.readContract({ address: hook, abi: RANGE_HOOK_ABI, functionName: "assetIsCurrency0" }),
        ]);
        let navSqrt: bigint;
        try {
          [, , navSqrt] = await publicClient.readContract({ address: hook, abi: RANGE_HOOK_ABI, functionName: "nav" });
        } catch (error) {
          if (revertReason(error) === undefined) throw error;
          return null;
        }
        const slot = keccak256(encodeAbiParameters(parseAbiParameters("bytes32, uint256"), [poolId, POOLS_SLOT]));
        const slot0 = BigInt(await publicClient.readContract({ address: manager, abi: POOL_MANAGER_ABI, functionName: "extsload", args: [slot] }));
        const poolSqrt = slot0 & ((1n << 160n) - 1n);
        if (navSqrt === 0n || poolSqrt === 0n) return null;
        // Pool prices are currency1 per currency0, so USTX's price in demo dollars is the ratio squared, or its inverse.
        const ratio = (Number(poolSqrt) / Number(navSqrt)) ** 2;
        return (assetIsCurrency0 ? ratio : 1 / ratio) - 1;
      },
      // A swap across the pool's bins, a redemption or an investment at the fund: about 300,000 gas, more when it crosses many bins.
      arbitrage: minProfit => send((n, fees) => walletClient.writeContract({ address: rangeArbitrage, abi: RANGE_ARBITRAGE_ABI, functionName: "arbitrage", args: [minProfit], nonce: n, ...fees, gas: 1_500_000n })),
    },
  };
}

type SenderClient = Parameters<typeof nonceCounts>[0] & Parameters<typeof outbidFees>[0] & {
  waitForTransactionReceipt(args: { hash: Hex; timeout: number }): Promise<{ status: "success" | "reverted" }>;
};

/**
 * The keeper's writes. Each run waits for every write's receipt, so a run starts from the chain's own
 * count; a node that counts more holds writes the chain never took (a network stall dropped them), and
 * a write at such a nonce outbids that copy. Writes in one run take consecutive nonces, so a node of
 * the load-balanced RPC that lags the last receipt cannot hand out a used nonce. A write that fails may
 * or may not have reached the network, so the next one asks the network again, paying more if a node
 * already held a write at its nonce.
 */
export function nonceSender(client: SenderClient, address: Address) {
  let nonce: number | undefined;
  let outbidBelow = 0;
  let failedAt: number | undefined;
  let tries = 0;
  return async function send(write: (nonce: number, fees: Fees) => Promise<Hex>): Promise<Sent> {
    let current = nonce;
    if (current === undefined) {
      const { latest, pending } = await nonceCounts(client, address);
      if (pending > latest) outbidBelow = Math.max(outbidBelow, pending);
      current = latest;
    }
    tries = failedAt === current ? tries + 1 : current < outbidBelow ? 1 : 0;
    let hash: Hex;
    try {
      hash = await write(current, tries > 0 ? await outbidFees(client, tries) : {});
    } catch (error) {
      nonce = undefined;
      failedAt = current;
      throw error;
    }
    nonce = current + 1;
    failedAt = undefined;
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    return { hash, success: receipt.status === "success" };
  };
}

/** The contract error a failed call reverted with, such as `Unprofitable(1834955, 1834943)`; undefined for any other failure. */
export function revertReason(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk(cause => cause instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return undefined;
  if (reverted.data) return `${reverted.data.errorName}(${(reverted.data.args ?? []).map(String).join(", ")})`;
  return reverted.reason ?? reverted.signature ?? "an unknown error";
}

// Log messages only; an RPC URL can carry a provider key.
function describe(error: unknown): string {
  const text = error instanceof Error ? (error as { shortMessage?: string }).shortMessage ?? error.message : String(error);
  return text.replace(/https?:\/\/\S+/g, "[rpc]").slice(0, 200);
}

export default {
  async scheduled(_controller: ScheduledController, env: KeeperEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      let chain: KeeperChain;
      try {
        chain = xlayerKeeperChain(env);
      } catch (error) {
        console.error(`keeper run failed: ${describe(error)}`);
        return;
      }
      await runKeeper(chain).then(outcome => console.log(JSON.stringify(outcome)), error => console.error(`keeper run failed: ${describe(error)}`));
      // The v4 pool's re-peg runs whatever became of the arbitrage.
      if (chain.v4) await runRepeg(chain.v4).then(outcome => console.log(JSON.stringify({ pool: "v4", ...outcome })), error => console.error(`v4 re-peg failed: ${describe(error)}`));
      if (chain.range) await runRangeArbitrage(chain.range, chain).then(outcome => console.log(JSON.stringify({ pool: "range", ...outcome })), error => console.error(`range arbitrage failed: ${describe(error)}`));
    })());
  },
  // The keeper only runs on its schedule; it serves nothing.
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<KeeperEnv>;
