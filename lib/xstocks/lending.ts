import {
  FUND_DEPLOYMENT, FUND_SELECTORS, addressWord, atBlock, call, fundErrorMessage, fundRpc, hexBlock, quantity, readBlock, readNav, revertData, word, words,
  type FundNav, type FundReceipt, type Rpc, type TransactionCall,
} from "./fund";

// The USTX lending market on X Layer Testnet (contracts/GanymedeLendingMarket.sol): lenders supply
// demo dollars, borrowers post USTX valued at the fund's NAV and borrow up to half of it. The app
// carries no keccak, so selectors are pinned here and tied to the compiled contract in
// onchain/test/AppFundClient.test.ts. Demo dollars and USTX have no value.

const WAD = 10n ** 18n;
const ONE_SHARE = 1_000_000n;
/** The contract's parameters, as 18-decimal fractions and demo-dollar micros. */
export const LENDING_TERMS = {
  borrowFactorWad: 500_000_000_000_000_000n,
  liquidationThresholdWad: 650_000_000_000_000_000n,
  liquidationBonusWad: 80_000_000_000_000_000n,
  minBorrowMicros: 10_000_000n,
} as const;
/** Passed as an amount, it withdraws or repays everything. */
export const LENDING_ALL = (1n << 256n) - 1n;

export const LENDING_SELECTORS = {
  paused: "0x5c975abb",
  cash: "0x961be391",
  totalSupplied: "0x630fd0ac",
  totalBorrowed: "0x4c19386c",
  utilization: "0xea21cd92",
  borrowRatePerYear: "0x7323d831",
  supplyRatePerYear: "0x0e943796",
  supplyBalanceOf: "0x93889f06",
  borrowBalanceOf: "0x374c49b4",
  collateralOf: "0x1aefb107",
  supply: "0x35403023",
  withdraw: "0x2e1a7d4d",
  supplyCollateral: "0x367febea",
  withdrawCollateral: "0x6112fe2e",
  borrow: "0xc5ebeaec",
  repay: "0x371fd8e6",
} as const;

export const LENDING_EVENTS = {
  supplied: "0x6473c9f7da8f23a3d810f05b3e8fb3945f0ad17deadcc09e302cdf5d58e48fe7",
  withdrawn: "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5",
  collateralSupplied: "0xb0c1a992a318d3f9e5ee4ef9bce6d9310f55f81d40dd18429c1b4ad5aca3d0d1",
  collateralWithdrawn: "0xc30fcfbcaac9e0deffa719714eaa82396ff506a0d0d0eebe170830177288715d",
  borrowed: "0xac59582e5396aca512fa873a2047e7f4c80f8f55d4a06cb34a78a0187f62719f",
  repaid: "0x0516911bcc3a0a7412a44601057c0a0a1ec628bde049a84284bc428866534488",
} as const;

/** The market's errors where they need other words than the fund's. */
export const LENDING_ERRORS: Record<string, string> = {
  "0x3a23d825": "That would take the loan past its borrow limit of 50% of the collateral's value.",
  "0xbb55fd27": "The market does not have that many demo dollars to lend right now.",
  "0x860b82a9": "A loan starts at $10.",
  "0xf4d678b8": "That is more than you have in the market.",
  "0xab35696f": "Lending is paused right now.",
};

export type LendingAction = "deposit" | "borrow" | "repay" | "withdrawCollateral" | "lend" | "withdraw";

const approve = (token: string, micros: bigint): TransactionCall => ({ to: token, data: `${FUND_SELECTORS.approve}${addressWord(FUND_DEPLOYMENT.lending)}${word(micros)}` });
const market = (selector: string, micros: bigint): TransactionCall => ({ to: FUND_DEPLOYMENT.lending, data: `${selector}${word(micros)}` });

export const lendingCalls = {
  approveDollars: (micros: bigint) => approve(FUND_DEPLOYMENT.dollar, micros),
  approveShares: (micros: bigint) => approve(FUND_DEPLOYMENT.fund, micros),
  supply: (micros: bigint) => market(LENDING_SELECTORS.supply, micros),
  withdraw: (micros: bigint) => market(LENDING_SELECTORS.withdraw, micros),
  supplyCollateral: (shares: bigint) => market(LENDING_SELECTORS.supplyCollateral, shares),
  withdrawCollateral: (shares: bigint) => market(LENDING_SELECTORS.withdrawCollateral, shares),
  borrow: (micros: bigint) => market(LENDING_SELECTORS.borrow, micros),
  repay: (micros: bigint) => market(LENDING_SELECTORS.repay, micros),
};

export type LendingMarket = {
  block: number;
  paused: boolean;
  /** Demo dollars in the market: what can be borrowed or withdrawn now. */
  cashMicros: bigint;
  suppliedMicros: bigint;
  borrowedMicros: bigint;
  utilizationWad: bigint;
  borrowRateWad: bigint;
  supplyRateWad: bigint;
  nav: FundNav;
};

export type LendingAccount = {
  gasWei: bigint;
  /** In the wallet. */
  dollarsMicros: bigint;
  sharesMicros: bigint;
  /** Approved to the market. */
  dollarAllowanceMicros: bigint;
  shareAllowanceMicros: bigint;
  /** In the market: lent with interest, owed with interest, and USTX posted. */
  suppliedMicros: bigint;
  debtMicros: bigint;
  collateralMicros: bigint;
};

/** The market, and one wallet's place in it when `account` is given, read at one block. */
export async function readLending(account: string | null, options: { rpc?: Rpc; minBlock?: number } = {}): Promise<{ market: LendingMarket; account: LendingAccount | null }> {
  const rpc = options.rpc ?? fundRpc();
  const block = await readBlock(rpc, options.minBlock);
  const tag = hexBlock(block);
  const one = (to: string, data: string) => call(rpc, to, data, tag).then(value => words(value, 1)[0]);
  const lending = FUND_DEPLOYMENT.lending;
  return atBlock(async () => {
    const [paused, cash, supplied, borrowed, utilization, borrowRate, supplyRate, nav] = await Promise.all([
      one(lending, LENDING_SELECTORS.paused), one(lending, LENDING_SELECTORS.cash), one(lending, LENDING_SELECTORS.totalSupplied), one(lending, LENDING_SELECTORS.totalBorrowed),
      one(lending, LENDING_SELECTORS.utilization), one(lending, LENDING_SELECTORS.borrowRatePerYear), one(lending, LENDING_SELECTORS.supplyRatePerYear), readNav(rpc, tag),
    ]);
    const marketState: LendingMarket = { block, paused: paused !== 0n, cashMicros: cash, suppliedMicros: supplied, borrowedMicros: borrowed, utilizationWad: utilization, borrowRateWad: borrowRate, supplyRateWad: supplyRate, nav };
    if (!account) return { market: marketState, account: null };
    const owner = addressWord(account);
    const spender = addressWord(lending);
    const [gas, dollars, shares, dollarAllowance, shareAllowance, lent, debt, collateral] = await Promise.all([
      rpc("eth_getBalance", [account, tag]).then(quantity),
      one(FUND_DEPLOYMENT.dollar, `${FUND_SELECTORS.balanceOf}${owner}`),
      one(FUND_DEPLOYMENT.fund, `${FUND_SELECTORS.balanceOf}${owner}`),
      one(FUND_DEPLOYMENT.dollar, `${FUND_SELECTORS.allowance}${owner}${spender}`),
      one(FUND_DEPLOYMENT.fund, `${FUND_SELECTORS.allowance}${owner}${spender}`),
      one(lending, `${LENDING_SELECTORS.supplyBalanceOf}${owner}`),
      one(lending, `${LENDING_SELECTORS.borrowBalanceOf}${owner}`),
      one(lending, `${LENDING_SELECTORS.collateralOf}${owner}`),
    ]);
    return {
      market: marketState,
      account: { gasWei: gas, dollarsMicros: dollars, sharesMicros: shares, dollarAllowanceMicros: dollarAllowance, shareAllowanceMicros: shareAllowance, suppliedMicros: lent, debtMicros: debt, collateralMicros: collateral },
    };
  });
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export type LendingPosition = {
  /** The collateral at the NAV, what it lets the wallet borrow, and the debt above which it can be liquidated. */
  valueMicros: bigint;
  borrowLimitMicros: bigint;
  liquidationLimitMicros: bigint;
  /** What more can be borrowed now: the limit less the debt, and no more than the market holds. */
  borrowableMicros: bigint;
  /** The USTX that can come back while the rest still covers the debt. */
  withdrawableMicros: bigint;
  /** Debt over collateral value, as an 18-decimal fraction; 0 without collateral. */
  loanToValueWad: bigint;
  /** The NAV per share at which the loan becomes liquidatable; null without a loan. */
  liquidationNavMicros: bigint | null;
};

/**
 * A wallet's loan at `navMicros`, with the contract's own rounding. What can be borrowed or
 * withdrawn leaves room for the interest the loan gains before the transaction is mined: 0.1% of
 * the debt, hours of interest even at the steepest rate.
 */
export function lendingPosition(collateralMicros: bigint, debtMicros: bigint, navMicros: bigint, cashMicros: bigint): LendingPosition {
  const valueMicros = collateralMicros * navMicros / ONE_SHARE;
  const borrowLimitMicros = collateralMicros * navMicros * LENDING_TERMS.borrowFactorWad / (ONE_SHARE * WAD);
  const liquidationLimitMicros = collateralMicros * navMicros * LENDING_TERMS.liquidationThresholdWad / (ONE_SHARE * WAD);
  const settling = debtMicros === 0n ? 0n : debtMicros + debtMicros / 1_000n + 1n;
  const headroom = borrowLimitMicros > settling ? borrowLimitMicros - settling : 0n;
  const borrowableMicros = headroom < cashMicros ? headroom : cashMicros;
  // withdrawCollateral requires debt ≤ remaining × NAV × 50%.
  const needed = settling === 0n || navMicros === 0n ? 0n : ceilDiv(settling * ONE_SHARE * WAD, navMicros * LENDING_TERMS.borrowFactorWad);
  const withdrawableMicros = collateralMicros > needed ? collateralMicros - needed : 0n;
  const loanToValueWad = valueMicros > 0n ? debtMicros * WAD / valueMicros : 0n;
  const liquidationNavMicros = debtMicros === 0n || collateralMicros === 0n ? null : debtMicros * ONE_SHARE * WAD / (collateralMicros * LENDING_TERMS.liquidationThresholdWad);
  return { valueMicros, borrowLimitMicros, liquidationLimitMicros, borrowableMicros, withdrawableMicros, loanToValueWad, liquidationNavMicros };
}

/** "3.90%" from an 18-decimal fraction, to two decimals, rounded down. */
export function formatWadPercent(wad: bigint): string {
  const basisPoints = wad * 10_000n / WAD;
  return `${basisPoints / 100n}.${(basisPoints % 100n).toString().padStart(2, "0")}%`;
}

export type LendingFill = { action: LendingAction; account: string; micros: bigint };

const ACTION_EVENTS: Record<string, LendingAction> = {
  [LENDING_EVENTS.collateralSupplied]: "deposit",
  [LENDING_EVENTS.borrowed]: "borrow",
  [LENDING_EVENTS.repaid]: "repay",
  [LENDING_EVENTS.collateralWithdrawn]: "withdrawCollateral",
  [LENDING_EVENTS.supplied]: "lend",
  [LENDING_EVENTS.withdrawn]: "withdraw",
};

/** The market's event for `action` in a receipt: the account and the amount that moved. */
export function lendingFill(receipt: FundReceipt, action: LendingAction): LendingFill | null {
  for (const log of receipt.logs) {
    if (typeof log.address !== "string" || log.address.toLowerCase() !== FUND_DEPLOYMENT.lending) continue;
    const topic = log.topics?.[0]?.toLowerCase();
    if (!topic || ACTION_EVENTS[topic] !== action) continue;
    return { action, account: `0x${String(log.topics[1]).slice(-40)}`.toLowerCase(), micros: words(log.data, 1)[0] };
  }
  return null;
}

/** A customer-facing reason for a failed lending request, in the market's words where they differ. */
export function lendingErrorMessage(error: unknown): string {
  const data = revertData(error);
  return (data && LENDING_ERRORS[data.slice(0, 10).toLowerCase()]) ?? fundErrorMessage(error);
}
