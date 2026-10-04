import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, http, maxUint256, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xlayerTestnet } from "./chain";

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
 * set, it brings the pool of one's own positions to the NAV through the fund, which needs no money. Its key (KEEPER_PRIVATE_KEY, a Worker secret) holds testnet OKB for gas and
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

/** The pool of one's own positions: its arbitrage needs no money, so the keeper only runs it as a call and sends it when it pays. */
export interface RangeChain {
  /** The arbitrage's profit in demo-dollar micros, run as a call, or the error it would revert with. */
  simulate(): Promise<{ profit: bigint } | { revert: string }>;
  arbitrage(minProfit: bigint): Promise<Sent>;
}

export type RangeOutcome = { action: "none"; reason: string } | { action: "arbitrage" | "recentre"; profit: string; hash: Hex; success: boolean };

/**
 * Brings the range pool to the NAV when that earns at least a cent, insisting on half of it when it
 * lands. A profit of exactly 0 means no position lies between the price and the NAV: the trade then
 * only moves the price across that empty stretch, which positions need before they can open, so it
 * is sent for the gas alone.
 */
export async function runRangeArbitrage(chain: RangeChain): Promise<RangeOutcome> {
  const simulated = await chain.simulate();
  if ("revert" in simulated) return none(simulated.revert.startsWith("NothingToDo") ? "the range pool is within its fee of the NAV" : `the arbitrage would revert: ${simulated.revert}`);
  if (simulated.profit === 0n) {
    const sent = await chain.arbitrage(0n);
    return { action: "recentre", profit: "0", hash: sent.hash, success: sent.success };
  }
  if (simulated.profit < MIN_PROFIT_MICROS) return none(`the arbitrage would earn ${simulated.profit}, under the ${MIN_PROFIT_MICROS} worth a trade`);
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
  "error NothingToDo()",
  "error Unprofitable(uint256 profit)",
  "error TransferFailed()",
  "error NavUnavailable()",
  "error NavTooOld(uint256 updatedAt)",
  "error NavInFuture(uint256 updatedAt)",
  "error OutsideBand(int24 tick, int24 navTick)",
  "error BelowMinimum()",
  "error ContractPaused()",
]);

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

  // Writes in one run take consecutive nonces and wait for each receipt, so a node of the
  // load-balanced RPC that lags the last receipt cannot hand out a used nonce. A write that fails
  // may or may not have reached the network, so the next one asks the network again rather than
  // skip a nonce and wait behind a gap.
  let nonce: number | undefined;
  async function send(write: (nonce: number) => Promise<Hex>): Promise<Sent> {
    const current = nonce ?? await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    let hash: Hex;
    try {
      hash = await write(current);
    } catch (error) {
      nonce = undefined;
      throw error;
    }
    nonce = current + 1;
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    return { hash, success: receipt.status === "success" };
  }

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
    claim: () => send(n => walletClient.writeContract({ address: dollar, abi: DOLLAR_ABI, functionName: "claim", nonce: n, gas: 150_000n })),
    approve: () => send(n => walletClient.writeContract({ address: dollar, abi: DOLLAR_ABI, functionName: "approve", args: [arbitrage, maxUint256], nonce: n, gas: 80_000n })),
    arbitrage: (buyInPool, dollarsIn, minProfit) =>
      send(n => walletClient.writeContract({
        address: arbitrage,
        abi: ARBITRAGE_ABI,
        functionName: buyInPool ? "buyAndRedeem" : "investAndSell",
        args: [dollarsIn, minProfit],
        nonce: n,
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
      repeg: () => send(n => walletClient.writeContract({ address: hook, abi: HOOK_ABI, functionName: "repeg", nonce: n, gas: 900_000n })),
    },
    range: rangeArbitrage && {
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
      // A swap across the pool's bins, a redemption or an investment at the fund: about 300,000 gas, more when it crosses many bins.
      arbitrage: minProfit => send(n => walletClient.writeContract({ address: rangeArbitrage, abi: RANGE_ARBITRAGE_ABI, functionName: "arbitrage", args: [minProfit], nonce: n, gas: 1_500_000n })),
    },
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
      if (chain.range) await runRangeArbitrage(chain.range).then(outcome => console.log(JSON.stringify({ pool: "range", ...outcome })), error => console.error(`range arbitrage failed: ${describe(error)}`));
    })());
  },
  // The keeper only runs on its schedule; it serves nothing.
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<KeeperEnv>;
