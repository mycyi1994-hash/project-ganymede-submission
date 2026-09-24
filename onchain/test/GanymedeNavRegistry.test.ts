import { expect } from "chai";
import hre from "hardhat";
import { getAddress } from "viem";
import { productKey, toBytes32, toUnixSeconds } from "../../relayer/src/ids";

const CORE = productKey("core-20");
const YIELD = productKey("digital-income");

// A holdings hash exactly as lib/engine emits it: bare sha256 hex, no 0x.
const HOLDINGS = toBytes32("9f2c8ab1d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f");
const HOLDINGS_2 = toBytes32("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");

async function deploy() {
  const [admin, relayer, outsider] = await hre.viem.getWalletClients();
  const registry = await hre.viem.deployContract(
    "GanymedeNavRegistry",
    [admin.account.address, relayer.account.address],
    { client: { wallet: admin } },
  );
  return { registry, admin, relayer, outsider };
}

describe("GanymedeNavRegistry", () => {
  it("publishes NAV under the relayer's publisher role", async () => {
    const { registry, admin, relayer } = await deploy();
    expect(getAddress(await registry.read.publisher())).to.equal(getAddress(relayer.account.address));
    expect(getAddress(await registry.read.administrator())).to.equal(getAddress(admin.account.address));

    const effectiveAt = toUnixSeconds("2026-07-30T03:46:28.964Z");
    await registry.write.publishNav([CORE, 997964303n, 100000000000000n, HOLDINGS, effectiveAt], {
      account: relayer.account,
    });

    const snapshot = await registry.read.latestNav([CORE]);
    expect(snapshot[0]).to.equal(997964303n);
    expect(snapshot[1]).to.equal(100000000000000n);
    expect(snapshot[2]).to.equal(HOLDINGS);
    expect(snapshot[3]).to.equal(effectiveAt);
  });

  it("keeps one registry for every product — ids do not collide", async () => {
    const { registry, relayer } = await deploy();
    expect(CORE).to.not.equal(YIELD);

    const at = toUnixSeconds("2026-07-30T03:46:28.964Z");
    await registry.write.publishNav([CORE, 997964303n, 1n, HOLDINGS, at], { account: relayer.account });
    await registry.write.publishNav([YIELD, 1002113455n, 1n, HOLDINGS_2, at], { account: relayer.account });

    expect((await registry.read.latestNav([CORE]))[0]).to.equal(997964303n);
    expect((await registry.read.latestNav([YIELD]))[0]).to.equal(1002113455n);
  });

  it("rejects a stale or same-second republish", async () => {
    const { registry, relayer } = await deploy();
    const at = toUnixSeconds("2026-07-30T03:46:28.964Z");
    await registry.write.publishNav([CORE, 997964303n, 1n, HOLDINGS, at], { account: relayer.account });

    // Two engine cycles inside one second land on the same uint64.
    await expect(
      registry.write.publishNav([CORE, 998000000n, 1n, HOLDINGS_2, at], { account: relayer.account }),
    ).to.be.rejectedWith("StalePublication");

    // An older snapshot arriving late must not overwrite a newer one.
    await expect(
      registry.write.publishNav(
        [CORE, 990000000n, 1n, HOLDINGS_2, toUnixSeconds("2026-07-30T03:00:00.000Z")],
        { account: relayer.account },
      ),
    ).to.be.rejectedWith("StalePublication");
  });

  it("rejects an identical rebalance payload twice", async () => {
    const { registry, relayer } = await deploy();
    const at = toUnixSeconds("2026-07-30T03:46:28.964Z");
    await registry.write.publishRebalance([CORE, HOLDINGS, at], { account: relayer.account });
    await expect(
      registry.write.publishRebalance([CORE, HOLDINGS, at], { account: relayer.account }),
    ).to.be.rejectedWith("DuplicatePayload");
    expect(await registry.read.latestRebalanceHash([CORE])).to.equal(HOLDINGS);
  });

  it("refuses publication from any key other than the publisher", async () => {
    const { registry, admin, outsider } = await deploy();
    const at = toUnixSeconds("2026-07-30T03:46:28.964Z");
    // Even the administrator cannot publish — only the publisher role can.
    await expect(
      registry.write.publishNav([CORE, 1n, 1n, HOLDINGS, at], { account: admin.account }),
    ).to.be.rejectedWith("Unauthorized");
    await expect(
      registry.write.publishNav([CORE, 1n, 1n, HOLDINGS, at], { account: outsider.account }),
    ).to.be.rejectedWith("Unauthorized");
  });

  it("lets the admin rotate the publisher key without redeploying", async () => {
    const { registry, admin, outsider } = await deploy();
    await registry.write.setPublisher([outsider.account.address], { account: admin.account });
    const at = toUnixSeconds("2026-07-30T03:46:28.964Z");
    await registry.write.publishNav([CORE, 1n, 1n, HOLDINGS, at], { account: outsider.account });
    expect((await registry.read.latestNav([CORE]))[0]).to.equal(1n);
  });
});
