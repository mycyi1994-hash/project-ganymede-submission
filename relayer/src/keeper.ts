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
 * that would revert. Its key (KEEPER_PRIVATE_KEY, a Worker secret) holds testnet OKB for gas and
 * no-value demo dollars, claimed from the demo dollar when it runs low. It has no role on any
 * contract, and a trade that is no longer profitable when it lands reverts in the arbitrage contract.
 */

export interface KeeperEnv {
  KEEPER_PRIVATE_KEY?: string;
  ARBITRAGE_ADDRESS?: string;
  DOLLAR_ADDRESS?: string;
  SETTLEMENT_RPC_URL?: string;
}

/** The least a trade must earn to be worth sending, in demo-dollar micros: a cent. */
export const MIN_PROFIT_MICROS = 10_000n;
// The fund refuses investments under $10, and a claim adds 10,000 demo dollars.
const MIN_INVESTMENT_MICROS = 10_000_000n;
const CLAIM_MICROS = 10_000_000_000n;

export type Quote = { buyInPool: boolean; dollarsIn: bigint; dollarsOut: bigint };
export type Sent = { hash: Hex; success: boolean };
export type Simulation = { dollarsOut: bigint } | { revert: string };

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

function none(reason: string): KeeperOutcome {
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

const DOLLAR_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function nextClaimAt(address account) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function claim()",
]);

function address(value: string | undefined, name: string): Address {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} is not set.`);
  return value as Address;
}

/** The keeper's chain on X Layer Testnet, signing with KEEPER_PRIVATE_KEY. */
export function xlayerKeeperChain(env: KeeperEnv): KeeperChain {
  const key = env.KEEPER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("KEEPER_PRIVATE_KEY is not set.");
  const arbitrage = address(env.ARBITRAGE_ADDRESS, "ARBITRAGE_ADDRESS");
  const dollar = address(env.DOLLAR_ADDRESS, "DOLLAR_ADDRESS");
  const account = privateKeyToAccount(key as Hex);
  const transport = http(env.SETTLEMENT_RPC_URL || xlayerTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: xlayerTestnet, transport });
  const walletClient = createWalletClient({ chain: xlayerTestnet, transport, account });

  // Writes in one run take consecutive nonces and wait for each receipt, so a node of the
  // load-balanced RPC that lags the last receipt cannot hand out a used nonce.
  let nonce: number | undefined;
  async function send(write: (nonce: number) => Promise<Hex>): Promise<Sent> {
    nonce ??= await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    const hash = await write(nonce++);
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
    ctx.waitUntil(
      Promise.resolve()
        .then(() => runKeeper(xlayerKeeperChain(env)))
        .then(outcome => console.log(JSON.stringify(outcome)), error => console.error(`keeper run failed: ${describe(error)}`)),
    );
  },
  // The keeper only runs on its schedule; it serves nothing.
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<KeeperEnv>;
