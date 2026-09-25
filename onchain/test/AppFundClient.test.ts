import { expect } from "chai";
import hre from "hardhat";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toBytes, toEventSelector, toFunctionSelector, type AbiItem } from "viem";
import { FUND_DEPLOYMENT, FUND_ERRORS, FUND_EVENTS, FUND_SELECTORS, POOL_SELECTORS } from "../../lib/xstocks/fund";

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

  it("decodes the fund's events and errors", async () => {
    const { fund, dollar } = await abis();
    const events = fund.filter(item => item.type === "event") as unknown as Array<{ name: string; inputs: { type: string }[] }>;
    const invested = events.find(item => item.name === "Invested")!;
    const redeemed = events.find(item => item.name === "Redeemed")!;
    expect(FUND_EVENTS.invested).to.equal(toEventSelector(signature(invested)));
    expect(FUND_EVENTS.redeemed).to.equal(toEventSelector(signature(redeemed)));

    const errors = new Set([...fund, ...dollar].filter(item => item.type === "error").map(item => keccak256(toBytes(signature(item as never))).slice(0, 10)));
    for (const selector of Object.keys(FUND_ERRORS)) expect(errors.has(selector), selector).to.equal(true);
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
