import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, maxUint256, parseEventLogs, zeroAddress, type Hash } from "viem";
import { productKey, toBytes32 } from "../../relayer/src/ids";

const USTX = productKey("us-tech-x");
const HOLDINGS = toBytes32("3858e1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c296fb");
const USD = 1_000_000n;
const SHARE = 1_000_000n;
const WAD = 10n ** 18n;
const NAV = 100n * USD; // $100 per USTX keeps the arithmetic readable

// Interest accrues every second, so balances read a block later can be a few micros higher.
function expectNear(actual: bigint, expected: bigint, tolerance: bigint) {
  const difference = actual > expected ? actual - expected : expected - actual;
  expect(difference <= tolerance, `${actual} is not within ${tolerance} of ${expected}`).to.equal(true);
}

/** The revert reasons in a viem error and its causes. */
function errorNames(error: unknown): string {
  const parts: string[] = [];
  let current = error as Record<string, unknown> | undefined;
  for (let depth = 0; current && depth < 10; depth++) {
    const data = current.data as Record<string, unknown> | undefined;
    if (data && typeof data.errorName === "string") parts.push(data.errorName);
    if (typeof current.details === "string") parts.push(current.details);
    current = current.cause as Record<string, unknown> | undefined;
  }
  return parts.join(" ");
}

async function deploy() {
  const [admin, relayer, lender, borrower, liquidator, other] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address], { client: { wallet: admin } });
  const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address], { client: { wallet: admin } });
  const fund = await hre.viem.deployContract(
    "GanymedeBasketFund",
    ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address],
    { client: { wallet: admin } },
  );
  await dollar.write.setMinter([fund.address], { account: admin.account });
  const market = await hre.viem.deployContract("GanymedeLendingMarket", [dollar.address, fund.address, admin.account.address], { client: { wallet: admin } });

  async function publish(nav: bigint) {
    await time.increase(60);
    await registry.write.publishNav([USTX, nav, 0n, HOLDINGS, BigInt(await time.latest())], { account: relayer.account });
  }
  // Claims 10,000 demo dollars and approves the fund and the market for everything.
  async function prepare(wallet: typeof admin) {
    await dollar.write.claim({ account: wallet.account });
    await dollar.write.approve([market.address, maxUint256], { account: wallet.account });
    await dollar.write.approve([fund.address, maxUint256], { account: wallet.account });
    await fund.write.approve([market.address, maxUint256], { account: wallet.account });
  }
  // Buys USTX at the recorded NAV and posts all of it as collateral.
  async function post(wallet: typeof admin, dollars: bigint) {
    await fund.write.invest([dollars, 0n], { account: wallet.account });
    const shares = await fund.read.balanceOf([wallet.account.address]);
    await market.write.supplyCollateral([shares], { account: wallet.account });
    return shares;
  }
  async function activate() {
    await market.write.unpause({ account: admin.account });
  }
  async function liquidation(hash: Hash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const event = parseEventLogs({ abi: market.abi, logs: receipt.logs, eventName: "Liquidated" })[0];
    if (!event) throw new Error("no Liquidated event");
    return event.args;
  }
  return { registry, dollar, fund, market, admin, lender, borrower, liquidator, other, publish, prepare, post, activate, liquidation };
}

describe("GanymedeLendingMarket", () => {
  it("starts paused, so nothing is lent or borrowed until the administrator activates it", async () => {
    const { market, dollar, fund, admin, lender, borrower, publish, prepare, activate } = await deploy();
    expect(await market.read.paused()).to.equal(true);
    expect(getAddress(await market.read.dollar())).to.equal(getAddress(dollar.address));
    expect(getAddress(await market.read.fund())).to.equal(getAddress(fund.address));
    expect(getAddress(await market.read.administrator())).to.equal(getAddress(admin.account.address));

    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    await fund.write.invest([1_000n * USD, 0n], { account: borrower.account });
    await expect(market.write.supply([1_000n * USD], { account: lender.account })).to.be.rejectedWith("ContractPaused");
    await expect(market.write.supplyCollateral([SHARE], { account: borrower.account })).to.be.rejectedWith("ContractPaused");
    await expect(market.write.borrow([10n * USD], { account: borrower.account })).to.be.rejectedWith("ContractPaused");
    await expect(market.write.unpause({ account: lender.account })).to.be.rejectedWith("Unauthorized");

    await activate();
    expect(await market.read.paused()).to.equal(false);
    await market.write.supply([1_000n * USD], { account: lender.account });
    expect(await market.read.supplyBalanceOf([lender.account.address])).to.equal(1_000n * USD);
  });

  it("only lends the dollar the fund redeems into", async () => {
    const { fund, dollar, admin } = await deploy();
    const otherDollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address], { client: { wallet: admin } });
    const options = { client: { wallet: admin } };
    await expect(hre.viem.deployContract("GanymedeLendingMarket", [otherDollar.address, fund.address, admin.account.address], options)).to.be.rejectedWith("InvalidAddress");
    await expect(hre.viem.deployContract("GanymedeLendingMarket", [dollar.address, fund.address, zeroAddress], options)).to.be.rejectedWith("InvalidAddress");
  });

  it("lends demo dollars and gives them back", async () => {
    const { market, dollar, lender, prepare, activate } = await deploy();
    await activate();
    await prepare(lender);
    await expect(market.write.supply([0n], { account: lender.account })).to.be.rejectedWith("InvalidAmount");
    await market.write.supply([1_000n * USD], { account: lender.account });
    expect(await market.read.totalSupplied()).to.equal(1_000n * USD);
    expect(await market.read.cash()).to.equal(1_000n * USD);

    await market.write.withdraw([400n * USD], { account: lender.account });
    expect(await market.read.supplyBalanceOf([lender.account.address])).to.equal(600n * USD);
    await expect(market.write.withdraw([600n * USD + 1n], { account: lender.account })).to.be.rejectedWith("InsufficientBalance");
    await market.write.withdraw([maxUint256], { account: lender.account });
    expect(await market.read.supplyBalanceOf([lender.account.address])).to.equal(0n);
    expect(await market.read.totalSupplyPrincipal()).to.equal(0n);
    expect(await dollar.read.balanceOf([lender.account.address])).to.equal(10_000n * USD);
    await expect(market.write.withdraw([maxUint256], { account: lender.account })).to.be.rejectedWith("InvalidAmount");
  });

  it("lends up to half the value of the USTX posted, at the NAV the fund trades at", async () => {
    const { market, dollar, lender, borrower, other, publish, prepare, post, activate } = await deploy();
    await activate();
    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    await market.write.supply([5_000n * USD], { account: lender.account });
    expect(await post(borrower, 1_000n * USD)).to.equal(10n * SHARE);
    expect(await market.read.collateralValueOf([borrower.account.address])).to.deep.equal([1_000n * USD, 500n * USD, 650n * USD]);

    await expect(market.write.borrow([10n * USD - 1n], { account: borrower.account })).to.be.rejectedWith("BelowMinimum");
    await expect(market.write.borrow([500n * USD + 1n], { account: borrower.account })).to.be.rejectedWith("InsufficientCollateral");
    await market.write.borrow([500n * USD], { account: borrower.account });
    expectNear(await market.read.borrowBalanceOf([borrower.account.address]), 500n * USD, 5n);
    expect(await dollar.read.balanceOf([borrower.account.address])).to.equal(9_500n * USD);
    // The loan is at its limit, and interest keeps it just above.
    await expect(market.write.borrow([10n * USD], { account: borrower.account })).to.be.rejectedWith("InsufficientCollateral");

    // Only the dollars in the market can be lent.
    await prepare(other);
    await post(other, 10_000n * USD);
    await expect(market.write.borrow([4_500n * USD + 1n], { account: other.account })).to.be.rejectedWith("InsufficientLiquidity");
    await market.write.borrow([4_500n * USD], { account: other.account });
    expect(await market.read.cash()).to.equal(0n);
  });

  it("charges interest on the jump-rate curve and pays lenders 90% of it", async () => {
    const { market, dollar, lender, borrower, publish, prepare, post, activate } = await deploy();
    await activate();
    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    expect(await market.read.borrowRatePerYear()).to.equal((2n * WAD) / 100n);
    expect(await market.read.supplyRatePerYear()).to.equal(0n);

    await market.write.supply([10_000n * USD], { account: lender.account });
    await post(borrower, 10_000n * USD);
    await market.write.borrow([5_000n * USD], { account: borrower.account });
    // Half the dollars lent: 2% + 10% × 0.5 = 7% for borrowers, 7% × 0.5 × 0.9 = 3.15% for lenders.
    expectNear(await market.read.borrowRatePerYear(), (7n * WAD) / 100n, WAD / 100_000n);
    expectNear(await market.read.supplyRatePerYear(), (315n * WAD) / 10_000n, WAD / 100_000n);

    await time.increase(365 * 24 * 60 * 60);
    await market.write.accrueInterest();
    expectNear(await market.read.borrowBalanceOf([borrower.account.address]), 5_350n * USD, USD / 100n);
    expectNear(await market.read.supplyBalanceOf([lender.account.address]), 10_315n * USD, USD / 100n);
    expectNear(await market.read.reserves(), 35n * USD, USD / 100n);

    // The borrower claims again to cover the interest and repays it all; the lender takes everything out.
    await dollar.write.claim({ account: borrower.account });
    await market.write.repay([maxUint256], { account: borrower.account });
    expect(await market.read.borrowBalanceOf([borrower.account.address])).to.equal(0n);
    expect(await market.read.totalBorrowPrincipal()).to.equal(0n);
    await market.write.withdraw([maxUint256], { account: lender.account });
    expectNear(await dollar.read.balanceOf([lender.account.address]), 10_315n * USD, USD / 100n);
    expect(await market.read.totalSupplyPrincipal()).to.equal(0n);
    // What stays in the market is its 10% of the interest.
    expectNear(await market.read.cash(), 35n * USD, USD / 100n);
    expect(await market.read.reserves()).to.equal(await market.read.cash());
  });

  it("raises the borrow rate steeply above 80% of the dollars lent", async () => {
    const { market, lender, borrower, publish, prepare, post, activate } = await deploy();
    await activate();
    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    await market.write.supply([1_000n * USD], { account: lender.account });
    await post(borrower, 3_000n * USD);

    await market.write.borrow([800n * USD], { account: borrower.account });
    expectNear(await market.read.borrowRatePerYear(), (10n * WAD) / 100n, WAD / 100_000n);
    expectNear(await market.read.supplyRatePerYear(), (72n * WAD) / 1_000n, WAD / 100_000n);

    // All of it lent: 10% + 200% × 0.2 = 50%.
    await market.write.borrow([200n * USD], { account: borrower.account });
    expect(await market.read.utilization()).to.equal(WAD);
    expect(await market.read.borrowRatePerYear()).to.equal((50n * WAD) / 100n);
    expect(await market.read.supplyRatePerYear()).to.equal((45n * WAD) / 100n);
  });

  it("repays in part or in full and hands the collateral back once the loan is gone", async () => {
    const { market, fund, lender, borrower, publish, prepare, post, activate } = await deploy();
    await activate();
    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    await market.write.supply([1_000n * USD], { account: lender.account });
    const shares = await post(borrower, 1_000n * USD);
    await market.write.borrow([300n * USD], { account: borrower.account });

    await market.write.repay([100n * USD], { account: borrower.account });
    expectNear(await market.read.borrowBalanceOf([borrower.account.address]), 200n * USD, 10n);
    await expect(market.write.withdrawCollateral([maxUint256], { account: borrower.account })).to.be.rejectedWith("InsufficientCollateral");
    await market.write.repay([maxUint256], { account: borrower.account });
    expect(await market.read.borrowBalanceOf([borrower.account.address])).to.equal(0n);
    await expect(market.write.repay([USD], { account: borrower.account })).to.be.rejectedWith("InvalidAmount");

    await market.write.withdrawCollateral([maxUint256], { account: borrower.account });
    expect(await fund.read.balanceOf([borrower.account.address])).to.equal(shares);
    expect(await market.read.collateralOf([borrower.account.address])).to.equal(0n);
    expect(await market.read.totalCollateral()).to.equal(0n);
  });

  it("keeps enough collateral in the market to cover the loan", async () => {
    const { market, lender, borrower, publish, prepare, post, activate } = await deploy();
    await activate();
    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    await market.write.supply([1_000n * USD], { account: lender.account });
    await post(borrower, 1_000n * USD);
    await market.write.borrow([400n * USD], { account: borrower.account });

    // $900 left allows $450 of debt; $700 would allow only $350.
    await market.write.withdrawCollateral([SHARE], { account: borrower.account });
    await expect(market.write.withdrawCollateral([2n * SHARE], { account: borrower.account })).to.be.rejectedWith("InsufficientCollateral");
    await expect(market.write.withdrawCollateral([10n * SHARE], { account: borrower.account })).to.be.rejectedWith("InsufficientBalance");
    expect(await market.read.collateralOf([borrower.account.address])).to.equal(9n * SHARE);
  });

  it("liquidates a loan past 65% of its collateral at an 8% bonus, which the fund pays out at NAV", async () => {
    const { market, fund, dollar, lender, borrower, liquidator, publish, prepare, post, activate, liquidation } = await deploy();
    await activate();
    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    await prepare(liquidator);
    await market.write.supply([1_000n * USD], { account: lender.account });
    await post(borrower, 1_000n * USD);
    await market.write.borrow([500n * USD], { account: borrower.account });
    expect(await market.read.isLiquidatable([borrower.account.address])).to.equal(false);
    await expect(market.write.liquidate([borrower.account.address, maxUint256, 0n], { account: liquidator.account })).to.be.rejectedWith("NotLiquidatable");

    // USTX falls 25%: $750 of collateral carries at most $487.50 of debt.
    const lower = 75n * USD;
    await publish(lower);
    expect(await market.read.isLiquidatable([borrower.account.address])).to.equal(true);
    await expect(market.write.liquidate([borrower.account.address, maxUint256, 0n], { account: borrower.account })).to.be.rejectedWith("InvalidAddress");
    await expect(market.write.liquidate([borrower.account.address, maxUint256, 4n * SHARE], { account: liquidator.account })).to.be.rejectedWith("SlippageExceeded");

    const debt = await market.read.borrowBalanceOf([borrower.account.address]);
    const { repaid, seized, navPerShareMicros } = await liquidation(
      await market.write.liquidate([borrower.account.address, maxUint256, 0n], { account: liquidator.account }),
    );
    // Half the debt, paid for with USTX worth 8% more at the new NAV.
    expectNear(repaid, debt / 2n, 10n);
    expect(seized).to.equal((repaid * 108n * SHARE) / (100n * lower));
    expect(navPerShareMicros).to.equal(lower);
    expect(await fund.read.balanceOf([liquidator.account.address])).to.equal(seized);

    // The fund redeems the seized USTX at NAV, so the bonus is real.
    const before = await dollar.read.balanceOf([liquidator.account.address]);
    await fund.write.redeem([seized, 0n], { account: liquidator.account });
    const proceeds = (await dollar.read.balanceOf([liquidator.account.address])) - before;
    expectNear(proceeds, (repaid * 108n) / 100n, 100n);

    // What is left is healthy again: about $480 of USTX against $250 of debt.
    expect(await market.read.collateralOf([borrower.account.address])).to.equal(10n * SHARE - seized);
    expectNear(await market.read.borrowBalanceOf([borrower.account.address]), debt - repaid, 10n);
    expect(await market.read.isLiquidatable([borrower.account.address])).to.equal(false);
  });

  it("takes all the collateral left once it cannot cover the bonus, and the rest of the debt stays on the account", async () => {
    const { market, lender, borrower, liquidator, publish, prepare, post, activate, liquidation } = await deploy();
    await activate();
    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    await prepare(liquidator);
    await market.write.supply([1_000n * USD], { account: lender.account });
    await post(borrower, 1_000n * USD);
    await market.write.borrow([500n * USD], { account: borrower.account });

    // USTX falls 60%: $400 of collateral against $500 of debt.
    const crash = 40n * USD;
    await publish(crash);
    const first = await liquidation(await market.write.liquidate([borrower.account.address, maxUint256, 0n], { account: liquidator.account }));
    expect(first.seized).to.equal((first.repaid * 108n * SHARE) / (100n * crash));
    const held = await market.read.collateralOf([borrower.account.address]);
    expect(held).to.equal(10n * SHARE - first.seized);

    const second = await liquidation(await market.write.liquidate([borrower.account.address, maxUint256, 0n], { account: liquidator.account }));
    expect(second.seized).to.equal(held);
    const onePlusBonus = WAD + (8n * WAD) / 100n;
    expect(second.repaid).to.equal((held * crash * WAD + SHARE * onePlusBonus - 1n) / (SHARE * onePlusBonus));

    expect(await market.read.collateralOf([borrower.account.address])).to.equal(0n);
    expect(await market.read.isLiquidatable([borrower.account.address])).to.equal(false);
    await expect(market.write.liquidate([borrower.account.address, maxUint256, 0n], { account: liquidator.account })).to.be.rejectedWith("NotLiquidatable");
    expectNear(await market.read.borrowBalanceOf([borrower.account.address]), 500n * USD - first.repaid - second.repaid, 100n);
  });

  it("stops lending against a stale NAV but never stops repayment or withdrawal", async () => {
    const { market, lender, borrower, liquidator, publish, prepare, post, activate } = await deploy();
    await activate();
    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    await market.write.supply([1_000n * USD], { account: lender.account });
    await post(borrower, 1_000n * USD);
    await market.write.borrow([200n * USD], { account: borrower.account });

    await time.increase(3_601);
    await expect(market.write.borrow([10n * USD], { account: borrower.account })).to.be.rejectedWith("NavTooOld");
    await expect(market.write.withdrawCollateral([SHARE], { account: borrower.account })).to.be.rejectedWith("NavTooOld");
    await expect(market.read.collateralValueOf([borrower.account.address])).to.be.rejectedWith("NavTooOld");
    await expect(market.write.liquidate([borrower.account.address, maxUint256, 0n], { account: liquidator.account })).to.be.rejectedWith("NavTooOld");

    await market.write.repay([maxUint256], { account: borrower.account });
    await market.write.withdrawCollateral([maxUint256], { account: borrower.account });
    await market.write.withdraw([maxUint256], { account: lender.account });
    expect(await market.read.collateralOf([borrower.account.address])).to.equal(0n);
    expect(await market.read.totalSupplyPrincipal()).to.equal(0n);
  });

  it("pausing stops new positions but never exits", async () => {
    const { market, admin, lender, borrower, liquidator, publish, prepare, post, activate } = await deploy();
    await activate();
    await publish(NAV);
    await prepare(lender);
    await prepare(borrower);
    await market.write.supply([1_000n * USD], { account: lender.account });
    await post(borrower, 1_000n * USD);
    await market.write.borrow([100n * USD], { account: borrower.account });

    await expect(market.write.pause({ account: lender.account })).to.be.rejectedWith("Unauthorized");
    await market.write.pause({ account: admin.account });
    await expect(market.write.supply([USD], { account: lender.account })).to.be.rejectedWith("ContractPaused");
    await expect(market.write.supplyCollateral([SHARE], { account: borrower.account })).to.be.rejectedWith("ContractPaused");
    await expect(market.write.borrow([10n * USD], { account: borrower.account })).to.be.rejectedWith("ContractPaused");
    // Liquidation stays open; this loan is simply healthy.
    await expect(market.write.liquidate([borrower.account.address, maxUint256, 0n], { account: liquidator.account })).to.be.rejectedWith("NotLiquidatable");

    await market.write.repay([maxUint256], { account: borrower.account });
    await market.write.withdrawCollateral([maxUint256], { account: borrower.account });
    await market.write.withdraw([maxUint256], { account: lender.account });
    expect(await market.read.totalCollateral()).to.equal(0n);
    expect(await market.read.totalSupplyPrincipal()).to.equal(0n);
  });

  it("hands administration over in two steps", async () => {
    const { market, admin, lender, borrower } = await deploy();
    await expect(market.write.proposeAdministrator([lender.account.address], { account: lender.account })).to.be.rejectedWith("Unauthorized");
    await market.write.proposeAdministrator([lender.account.address], { account: admin.account });
    await expect(market.write.acceptAdministrator({ account: borrower.account })).to.be.rejectedWith("Unauthorized");
    await market.write.acceptAdministrator({ account: lender.account });
    expect(getAddress(await market.read.administrator())).to.equal(getAddress(lender.account.address));
    await expect(market.write.unpause({ account: admin.account })).to.be.rejectedWith("Unauthorized");
    await market.write.unpause({ account: lender.account });
    expect(await market.read.paused()).to.equal(false);
  });
  it("stays solvent and keeps every account's books, across random orders, NAV paths, time and pauses", async () => {
    // LENDING_FUZZ_SEEDS and LENDING_FUZZ_STEPS run it longer (LENDING_FUZZ_REPORT prints what
    // happened); each seed replays.
    const seeds = Number(process.env.LENDING_FUZZ_SEEDS ?? 3);
    const steps = Number(process.env.LENDING_FUZZ_STEPS ?? 60);
    const { market, dollar, fund, admin, lender, borrower, liquidator, other, publish, prepare, activate } = await deploy();
    const accounts = [lender, borrower, other];
    let nav = NAV;
    await publish(nav);
    for (const wallet of [...accounts, liquidator]) await prepare(wallet);
    await activate();
    let paused = false;
    const counts: Record<string, number> = {};
    const tally = (name: string) => { counts[name] = (counts[name] ?? 0) + 1; };
    // Runs one order; a refusal must be one of the reasons it may give, and never a pause unless it
    // is an order a pause stops.
    async function attempt(name: string, order: () => Promise<unknown>, allowed: string[]) {
      try {
        await order();
        tally(name);
        return true;
      } catch (error) {
        const names = errorNames(error);
        const reason = allowed.find(allowedReason => names.includes(allowedReason));
        if (!reason) throw new Error(`${name} failed with ${names}: ${String(error).slice(0, 1500)}`);
        tally(`${name} refused: ${reason}`);
        return false;
      }
    }
    const pauseStops = (stoppable: boolean) => (stoppable && paused ? ["ContractPaused"] : []);
    async function checkBooks(where: string) {
      const principals = await Promise.all(accounts.map(async wallet => [
        await market.read.supplyPrincipalOf([wallet.account.address]),
        await market.read.borrowPrincipalOf([wallet.account.address]),
        await market.read.collateralOf([wallet.account.address]),
      ]));
      const sum = (index: number) => principals.reduce((total, row) => total + row[index], 0n);
      expect(sum(0), `${where}: lenders' principal`).to.equal(await market.read.totalSupplyPrincipal());
      expect(sum(1), `${where}: borrowers' principal`).to.equal(await market.read.totalBorrowPrincipal());
      expect(sum(2), `${where}: collateral`).to.equal(await market.read.totalCollateral());
      expect(await fund.read.balanceOf([market.address]), `${where}: USTX held`).to.equal(await market.read.totalCollateral());
      // What the market holds and is owed always covers what it owes its lenders, to rounding.
      const assets = (await market.read.cash()) + (await market.read.totalBorrowed());
      const owed = await market.read.totalSupplied();
      expect(assets + 10n >= owed, `${where}: holds and is owed ${assets}, owes ${owed}`).to.equal(true);
    }
    for (let run = 0; run < seeds; run++) {
      let state = 0x51ed2701n + BigInt(run) * 0x9e3779b9n;
      const random = (below: bigint) => {
        state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
        return (state >> 33n) % below;
      };
      for (let step = 0; step < steps; step++) {
        const where = `seed ${run} step ${step}`;
        // Time passes, from seconds to a couple of weeks, and a new record follows, from 15% down to
        // 9% up, so loans drift toward liquidation; after a crash below $20 the price recovers.
        if (random(4n) === 0n) await time.increase(Number(random(14n * 86_400n)) + 1);
        if (random(2n) === 0n) nav = (nav * (10_000n + random(2_400n) - 1_500n)) / 10_000n;
        if (nav < 20n * USD) nav = NAV;
        await publish(nav);
        // The administrator pauses now and then, for a few steps at a time.
        if (random(paused ? 4n : 25n) === 0n) {
          paused = !paused;
          await (paused ? market.write.pause({ account: admin.account }) : market.write.unpause({ account: admin.account }));
        }
        const wallet = accounts[Number(random(BigInt(accounts.length)))];
        const address = wallet.account.address;
        // A wallet low on demo dollars claims more the next day.
        if (await dollar.read.balanceOf([address]) < 1_000n * USD) {
          await time.increase(86_400);
          await dollar.write.claim({ account: wallet.account });
          await publish(nav);
        }
        const dollars = await dollar.read.balanceOf([address]);
        const amount = (random(1_500n) + 1n) * USD + random(USD);
        switch (random(11n)) {
          case 0n:
            await attempt("supply", () => market.write.supply([amount < dollars ? amount : dollars], { account: wallet.account }), ["InvalidAmount", ...pauseStops(true)]);
            break;
          case 1n: {
            const all = random(3n) === 0n;
            const balance = await market.read.supplyBalanceOf([address]);
            await attempt("withdraw", () => market.write.withdraw([all ? maxUint256 : random(balance + 1n)], { account: wallet.account }), ["InvalidAmount", "InsufficientLiquidity", "InsufficientBalance"]);
            break;
          }
          case 2n:
          case 3n: {
            const invest = amount / 2n < dollars ? amount / 2n : dollars;
            if (invest >= 10n * USD && !paused) await fund.write.invest([invest, 0n], { account: wallet.account });
            const shares = await fund.read.balanceOf([address]);
            await attempt("post collateral", () => market.write.supplyCollateral([shares], { account: wallet.account }), ["InvalidAmount", ...pauseStops(true)]);
            break;
          }
          case 4n: {
            const held = await market.read.collateralOf([address]);
            if (await attempt("withdraw collateral", () => market.write.withdrawCollateral([random(4n) === 0n ? maxUint256 : random(held + 1n)], { account: wallet.account }), ["InvalidAmount", "InsufficientCollateral"])) {
              const [, limit] = await market.read.collateralValueOf([address]);
              const debt = await market.read.borrowBalanceOf([address]);
              expect(debt === 0n || debt <= limit + 1n, `${where}: collateral left ${limit} under debt ${debt}`).to.equal(true);
            }
            break;
          }
          case 5n:
          case 6n:
          case 7n: {
            const [, limit] = await market.read.collateralValueOf([address]);
            const debt = await market.read.borrowBalanceOf([address]);
            const room = limit > debt ? limit - debt : 0n;
            // Mostly within the limit, sometimes over it, which must be refused.
            const ask = random(5n) === 0n ? room + USD : random(2n) === 0n ? room : room / 2n + random(room / 2n + 1n);
            if (await attempt("borrow", () => market.write.borrow([ask], { account: wallet.account }), ["InvalidAmount", "BelowMinimum", "InsufficientLiquidity", "InsufficientCollateral", ...pauseStops(true)])) {
              const [, after] = await market.read.collateralValueOf([address]);
              expect(await market.read.borrowBalanceOf([address]) <= after + 1n, `${where}: borrowed past the limit`).to.equal(true);
            }
            break;
          }
          case 8n: {
            const debt = await market.read.borrowBalanceOf([address]);
            if (debt > dollars) {
              await time.increase(86_400);
              await dollar.write.claim({ account: wallet.account });
              await publish(nav);
            }
            await attempt("repay", () => market.write.repay([random(3n) === 0n ? maxUint256 : random(debt + 1n)], { account: wallet.account }), ["InvalidAmount"]);
            break;
          }
          default: {
            const liquidatable = await market.read.isLiquidatable([address]);
            const held = await market.read.collateralOf([address]);
            const debtBefore = await market.read.borrowBalanceOf([address]);
            if (await dollar.read.balanceOf([liquidator.account.address]) < debtBefore) {
              await time.increase(86_400);
              await dollar.write.claim({ account: liquidator.account });
              await publish(nav);
            }
            const done = await attempt("liquidate", () => market.write.liquidate([address, maxUint256, 0n], { account: liquidator.account }), ["NotLiquidatable", "InvalidAmount"]);
            // Only a loan past the threshold can be liquidated, at most half of it is repaid at a
            // time, and never more USTX is taken than was posted.
            if (done) {
              expect(liquidatable, `${where}: liquidated a covered loan`).to.equal(true);
              expect(await market.read.collateralOf([address]) <= held).to.equal(true);
              expect(await market.read.borrowBalanceOf([address]) >= debtBefore / 2n - 1n, `${where}: repaid more than the close factor`).to.equal(true);
            } else if (liquidatable && debtBefore > 0n && held > 0n) {
              throw new Error(`${where}: a loan past the threshold could not be liquidated`);
            }
          }
        }
        await checkBooks(where);
      }
    }
    // Everyone can still leave: borrowers repay and take back their USTX, then lenders withdraw all.
    if (paused) await market.write.unpause({ account: admin.account });
    await time.increase(86_400);
    await publish(nav);
    for (const wallet of accounts) {
      if (await market.read.borrowBalanceOf([wallet.account.address]) > 0n) {
        await dollar.write.claim({ account: wallet.account });
        await market.write.repay([maxUint256], { account: wallet.account });
      }
      if (await market.read.collateralOf([wallet.account.address]) > 0n) await market.write.withdrawCollateral([maxUint256], { account: wallet.account });
    }
    for (const wallet of accounts) {
      if (await market.read.supplyPrincipalOf([wallet.account.address]) > 0n) await market.write.withdraw([maxUint256], { account: wallet.account });
    }
    await checkBooks("after everyone left");
    expect([await market.read.totalSupplyPrincipal(), await market.read.totalBorrowPrincipal(), await market.read.totalCollateral()]).to.deep.equal([0n, 0n, 0n]);
    // What stays is the market's share of the interest.
    expect(await market.read.cash()).to.equal(await market.read.reserves());
    if (process.env.LENDING_FUZZ_REPORT) console.log(JSON.stringify(counts));
    for (const name of ["supply", "withdraw", "post collateral", "borrow", "repay", "liquidate"]) {
      expect((counts[name] ?? 0) > 0, `no ${name} in ${JSON.stringify(counts)}`).to.equal(true);
    }
  }).timeout(0); // its length follows LENDING_FUZZ_SEEDS and LENDING_FUZZ_STEPS
});
