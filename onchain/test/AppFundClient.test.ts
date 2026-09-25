import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, maxUint256, toBytes, toEventSelector, toFunctionSelector, type AbiItem, type Address } from "viem";
import {
  FUND_DEPLOYMENT, FUND_ERRORS, FUND_EVENTS, FUND_SELECTORS, POOL_EVENTS, POOL_SELECTORS, poolAmountOut, poolCalls, poolFill, routeOrder, type FundReceipt,
} from "../../lib/xstocks/fund";
import { productKey, toBytes32 } from "../../relayer/src/ids";

// The app carries no keccak, so lib/xstocks/fund.ts hard-codes selectors and addresses.
// These checks tie them to the compiled contracts and to the deployment record.

const signature = (item: { name: string; inputs: readonly { type: string }[] }) => `${item.name}(${item.inputs.map(input => input.type).join(",")})`;

async function abis() {
  const [fund, dollar] = await Promise.all([hre.artifacts.readArtifact("GanymedeBasketFund"), hre.artifacts.readArtifact("GanymedeDemoDollar")]);
  return { fund: fund.abi as readonly AbiItem[], dollar: dollar.abi as readonly AbiItem[] };
}

describe("App fund client", () => {
  it("uses the selectors of the compiled contracts", async () => {
    const { fund, dollar } = await abis();
    const selectors = new Set([...fund, ...dollar].filter(item => item.type === "function").map(item => toFunctionSelector(item as never)));
    for (const [name, selector] of Object.entries(FUND_SELECTORS)) expect(selectors.has(selector), name).to.equal(true);
    expect(FUND_SELECTORS.invest).to.equal(toFunctionSelector("invest(uint256,uint256)"));
    expect(FUND_SELECTORS.redeem).to.equal(toFunctionSelector("redeem(uint256,uint256)"));
    expect(FUND_SELECTORS.approve).to.equal(toFunctionSelector("approve(address,uint256)"));
    const pool = (await hre.artifacts.readArtifact("GanymedeUstxPool")).abi as readonly AbiItem[];
    const poolSelectors = new Set(pool.filter(item => item.type === "function").map(item => toFunctionSelector(item as never)));
    for (const [name, selector] of Object.entries(POOL_SELECTORS)) expect(poolSelectors.has(selector), name).to.equal(true);
  });

  it("decodes the fund's and the pool's events and errors", async () => {
    const { fund, dollar } = await abis();
    const pool = (await hre.artifacts.readArtifact("GanymedeUstxPool")).abi as readonly AbiItem[];
    const events = [...fund, ...pool].filter(item => item.type === "event") as unknown as Array<{ name: string; inputs: { type: string }[] }>;
    const topic = (name: string) => toEventSelector(signature(events.find(item => item.name === name)!));
    expect(FUND_EVENTS.invested).to.equal(topic("Invested"));
    expect(FUND_EVENTS.redeemed).to.equal(topic("Redeemed"));
    expect(POOL_EVENTS.bought).to.equal(topic("Bought"));
    expect(POOL_EVENTS.sold).to.equal(topic("Sold"));
    expect(POOL_SELECTORS.buy).to.equal(toFunctionSelector("buy(uint256,uint256,uint256)"));
    expect(POOL_SELECTORS.sell).to.equal(toFunctionSelector("sell(uint256,uint256,uint256)"));

    const errors = new Set([...fund, ...dollar, ...pool].filter(item => item.type === "error").map(item => keccak256(toBytes(signature(item as never))).slice(0, 10)));
    for (const selector of Object.keys(FUND_ERRORS)) expect(errors.has(selector), selector).to.equal(true);
  });

  it("quotes, routes, encodes and reads pool orders exactly as the pool contract does", async () => {
    const USD = 1_000_000n;
    const USTX = productKey("us-tech-x");
    const [admin, relayer, trader] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address]);
    const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
    const fund = await hre.viem.deployContract("GanymedeBasketFund", ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address]);
    await dollar.write.setMinter([fund.address]);
    // The app's calldata names the deployed pool, so this pool's code (its immutables name the local
    // fund and dollar) runs at that address.
    const local = await hre.viem.deployContract("GanymedeUstxPool", [fund.address]);
    await hre.network.provider.request({ method: "hardhat_setCode", params: [FUND_DEPLOYMENT.pool, await publicClient.getCode({ address: local.address })] });
    const pool = await hre.viem.getContractAt("GanymedeUstxPool", FUND_DEPLOYMENT.pool as Address);
    await time.increase(60);
    await registry.write.publishNav([USTX, 100n * USD, 0n, toBytes32("11".repeat(32)), BigInt(await time.latest())], { account: relayer.account });
    // A liquidity provider opens the pool at the NAV: 50 USTX and $5,000.
    await dollar.write.claim();
    await dollar.write.approve([fund.address, maxUint256]);
    await fund.write.invest([5_000n * USD, 0n]);
    await dollar.write.approve([pool.address, maxUint256]);
    await fund.write.approve([pool.address, maxUint256]);
    await pool.write.addLiquidity([50n * USD, 5_000n * USD, 0n, 0n, maxUint256]);

    // The trader uses the app's own calldata, sent unchanged: approvals, a sale and a purchase.
    await dollar.write.claim({ account: trader.account });
    await dollar.write.approve([fund.address, maxUint256], { account: trader.account });
    await fund.write.invest([1_000n * USD, 0n], { account: trader.account });
    const send = async (to: Address, data: string) => {
      const hash = await trader.sendTransaction({ to, data: data as `0x${string}` });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");
      return { hash, block: Number(receipt.blockNumber), status: "success", logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics], data: log.data })) } as FundReceipt;
    };
    await send(dollar.address, poolCalls.approveDollars(maxUint256).data);
    await send(fund.address, poolCalls.approveShares(maxUint256).data);
    expect(await dollar.read.allowance([trader.account.address, pool.address])).to.equal(maxUint256);
    expect(await fund.read.allowance([trader.account.address, pool.address])).to.equal(maxUint256);

    const deadline = Number(await time.latest()) + 600;
    // A sale pushes the pool below the NAV; after it a buy routes to the pool and a sale to the fund.
    const sale = poolAmountOut(3n * USD, 50n * USD, 5_000n * USD);
    expect(poolFill(await send(pool.address, poolCalls.sell(3n * USD, sale, deadline).data)))
      .to.deep.equal({ side: "sell", trader: trader.account.address.toLowerCase(), sharesMicros: 3n * USD, dollarsMicros: sale });
    const [shares, dollars] = await pool.read.getReserves();
    for (const size of [1n, 3_700_000n, 250n * USD, 4_000n * USD]) {
      expect(poolAmountOut(size, dollars, shares), `buy ${size}`).to.equal(await pool.read.quoteBuy([size]));
      expect(poolAmountOut(size, shares, dollars), `sell ${size}`).to.equal(await pool.read.quoteSell([size]));
    }
    const [nav] = await fund.read.currentNav();
    const route = routeOrder("buy", 100n * USD, nav, { sharesMicros: shares, dollarsMicros: dollars });
    expect(route.best).to.equal("pool");
    expect(routeOrder("sell", USD, nav, { sharesMicros: shares, dollarsMicros: dollars }).best).to.equal("fund");
    const buy = await send(pool.address, poolCalls.buy(100n * USD, route.pool!, deadline).data);
    expect(poolFill(buy)).to.deep.equal({ side: "buy", trader: trader.account.address.toLowerCase(), dollarsMicros: 100n * USD, sharesMicros: route.pool });
    expect(await fund.read.balanceOf([trader.account.address])).to.equal(10n * USD - 3n * USD + route.pool!);
    // A slippage limit above the quote is refused with the error the app explains.
    await expect(trader.sendTransaction({ to: pool.address, data: poolCalls.buy(100n * USD, 10n ** 12n, deadline).data as `0x${string}` })).to.be.rejectedWith("SlippageExceeded");
    expect(FUND_ERRORS["0x8199f5f3"]).to.match(/price changed/);
  });

  it("points at the recorded deployment", () => {
    const record = JSON.parse(readFileSync(join(__dirname, "..", "deployments", "xlayer-testnet.json"), "utf8"));
    expect(FUND_DEPLOYMENT.fund).to.equal(record.contracts.GanymedeBasketFund.address);
    expect(FUND_DEPLOYMENT.dollar).to.equal(record.contracts.GanymedeDemoDollar.address);
    expect(FUND_DEPLOYMENT.feed).to.equal(record.contracts.GanymedeNavFeed.address);
    expect(FUND_DEPLOYMENT.pool).to.equal(record.contracts.GanymedeUstxPool.address);
    expect(FUND_DEPLOYMENT.arbitrage).to.equal(record.contracts.GanymedeNavArbitrage.address);
    expect(FUND_DEPLOYMENT.chainId).to.equal(record.chainId);
  });
});
