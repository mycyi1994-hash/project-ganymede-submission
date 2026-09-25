import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, parseAbi, zeroAddress } from "viem";
import { productKey, toBytes32 } from "../../relayer/src/ids";

const USTX = productKey("us-tech-x");
const OTHER = productKey("core-20");
const HOLDINGS = toBytes32("3858e1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c296fb");
const NAV = 99_449_929n; // $99.449929 per share, 6 decimals in the registry

// The interface Chainlink price feeds expose, written out independently of our contract.
const AGGREGATOR_V3 = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function version() view returns (uint256)",
  "function getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

async function deploy() {
  const [admin, relayer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address], { client: { wallet: admin } });
  const feed = await hre.viem.deployContract("GanymedeNavFeed", [registry.address, USTX, "USTX / USD"], { client: { wallet: admin } });

  // Each record needs a later effective time than the last, as the registry requires.
  async function publish(nav: bigint, product = USTX) {
    await time.increase(60);
    const effectiveAt = BigInt(await time.latest());
    await registry.write.publishNav([product, nav, 0n, HOLDINGS, effectiveAt], { account: relayer.account });
    return effectiveAt;
  }
  return { registry, feed, admin, publicClient, publish };
}

describe("GanymedeNavFeed", () => {
  it("describes itself as an 8-decimal USD feed for one product", async () => {
    const { feed, registry } = await deploy();
    expect(await feed.read.decimals()).to.equal(8);
    expect(await feed.read.description()).to.equal("USTX / USD");
    expect(await feed.read.version()).to.equal(1n);
    expect(getAddress(await feed.read.registry())).to.equal(getAddress(registry.address));
    expect(await feed.read.productId()).to.equal(USTX);
  });

  it("has no answer before the first record", async () => {
    const { feed } = await deploy();
    await expect(feed.read.latestRoundData()).to.be.rejectedWith("NoDataPresent");
    await expect(feed.read.latestAnswer()).to.be.rejectedWith("NoDataPresent");
  });

  it("answers with the registry's latest record, the effective time as round and update time", async () => {
    const { feed, publish } = await deploy();
    const first = await publish(NAV);
    expect(await feed.read.latestRoundData()).to.deep.equal([first, NAV * 100n, first, first, first]);
    expect(await feed.read.latestAnswer()).to.equal(9_944_992_900n);
    expect(await feed.read.latestTimestamp()).to.equal(first);
    expect(await feed.read.latestRound()).to.equal(first);

    const higher = NAV + 1_234_567n;
    const second = await publish(higher);
    expect(await feed.read.latestRoundData()).to.deep.equal([second, higher * 100n, second, second, second]);
  });

  it("follows only its own product", async () => {
    const { feed, publish } = await deploy();
    await publish(NAV, OTHER);
    await expect(feed.read.latestRoundData()).to.be.rejectedWith("NoDataPresent");
    const round = await publish(NAV);
    await publish(2n * NAV, OTHER);
    expect(await feed.read.latestAnswer()).to.equal(NAV * 100n);
    expect(await feed.read.latestRound()).to.equal(round);
  });

  it("serves the latest round only", async () => {
    const { feed, publish } = await deploy();
    const first = await publish(NAV);
    const second = await publish(NAV + 1n);
    expect(await feed.read.getRoundData([second])).to.deep.equal([second, (NAV + 1n) * 100n, second, second, second]);
    await expect(feed.read.getRoundData([first])).to.be.rejectedWith("NoDataPresent");
  });

  it("reads through the standard AggregatorV3Interface ABI", async () => {
    const { feed, publicClient, publish } = await deploy();
    const round = await publish(NAV);
    const read = <F extends "decimals" | "description" | "version" | "latestRoundData">(functionName: F) =>
      publicClient.readContract({ address: feed.address, abi: AGGREGATOR_V3, functionName });
    expect(await read("decimals")).to.equal(8);
    expect(await read("description")).to.equal("USTX / USD");
    expect(await read("version")).to.equal(1n);
    expect(await read("latestRoundData")).to.deep.equal([round, NAV * 100n, round, round, round]);
    expect(
      await publicClient.readContract({ address: feed.address, abi: AGGREGATOR_V3, functionName: "getRoundData", args: [round] }),
    ).to.deep.equal([round, NAV * 100n, round, round, round]);
  });

  it("prices USTX exactly as the fund trades it", async () => {
    const { feed, registry, admin, publish } = await deploy();
    const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address], { client: { wallet: admin } });
    const fund = await hre.viem.deployContract(
      "GanymedeBasketFund",
      ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address],
      { client: { wallet: admin } },
    );
    const effectiveAt = await publish(NAV);
    const [nav, fundEffectiveAt] = await fund.read.currentNav();
    const [round, answer, , updatedAt] = await feed.read.latestRoundData();
    expect(answer).to.equal(nav * 100n);
    expect(updatedAt).to.equal(BigInt(fundEffectiveAt));
    expect(round).to.equal(effectiveAt);
  });

  it("needs a registry and a product", async () => {
    const { registry, admin } = await deploy();
    const options = { client: { wallet: admin } };
    await expect(hre.viem.deployContract("GanymedeNavFeed", [zeroAddress, USTX, "USTX / USD"], options)).to.be.rejectedWith("InvalidAddress");
    await expect(
      hre.viem.deployContract("GanymedeNavFeed", [registry.address, `0x${"0".repeat(64)}`, "USTX / USD"], options),
    ).to.be.rejectedWith("InvalidProduct");
  });
});
