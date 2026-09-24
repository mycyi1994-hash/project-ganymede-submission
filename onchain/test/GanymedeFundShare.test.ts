import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseUnits } from "viem";
import { settlementKey } from "../../relayer/src/ids";

const SHARES = parseUnits("1000", 6); // 6-decimal fund share

async function deploy() {
  const [admin, relayer, investor, outsider] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const share = await hre.viem.deployContract(
    "GanymedeFundShare",
    ["Ganymede Core 20", "GMDCORE", admin.account.address],
    { client: { wallet: admin } },
  );
  // Production wiring: issuance moves to the relayer, allowlisting stays on admin.
  await share.write.setIssuer([relayer.account.address], { account: admin.account });
  return { share, admin, relayer, investor, outsider, publicClient };
}

describe("GanymedeFundShare", () => {
  it("wires issuance to the relayer while allowlisting stays with the admin", async () => {
    const { share, admin, relayer } = await deploy();
    expect(getAddress(await share.read.issuer())).to.equal(getAddress(relayer.account.address));
    expect(getAddress(await share.read.administrator())).to.equal(getAddress(admin.account.address));
    expect(getAddress(await share.read.transferAgent())).to.equal(getAddress(admin.account.address));
  });

  it("mints an allowlisted subscription", async () => {
    const { share, admin, relayer, investor } = await deploy();
    await share.write.setInvestorPermission([investor.account.address, true], { account: admin.account });

    const id = settlementKey("subscription", "sub_abc123", "mint_subscription");
    await share.write.settleSubscription([id, investor.account.address, SHARES], {
      account: relayer.account,
    });

    expect(await share.read.balanceOf([investor.account.address])).to.equal(SHARES);
    expect(await share.read.totalSupply()).to.equal(SHARES);
    expect(await share.read.processedSettlement([id])).to.equal(true);
  });

  it("rejects a replayed settlement id — the double-mint backstop", async () => {
    const { share, admin, relayer, investor } = await deploy();
    await share.write.setInvestorPermission([investor.account.address, true], { account: admin.account });

    const id = settlementKey("subscription", "sub_abc123", "mint_subscription");
    await share.write.settleSubscription([id, investor.account.address, SHARES], {
      account: relayer.account,
    });

    // A relayer retry derives the same id and must not mint again.
    await expect(
      share.write.settleSubscription([id, investor.account.address, SHARES], {
        account: relayer.account,
      }),
    ).to.be.rejectedWith("SettlementAlreadyProcessed");

    expect(await share.read.totalSupply()).to.equal(SHARES);
  });

  it("refuses to mint to a wallet that is not allowlisted", async () => {
    const { share, relayer, outsider } = await deploy();
    const id = settlementKey("subscription", "sub_nope", "mint_subscription");
    await expect(
      share.write.settleSubscription([id, outsider.account.address, SHARES], {
        account: relayer.account,
      }),
    ).to.be.rejectedWith("TransferRestricted");
  });

  it("does not let the relayer key allowlist, pause or reassign roles", async () => {
    const { share, relayer, investor } = await deploy();
    await expect(
      share.write.setInvestorPermission([investor.account.address, true], { account: relayer.account }),
    ).to.be.rejectedWith("Unauthorized");
    await expect(share.write.pause({ account: relayer.account })).to.be.rejectedWith("Unauthorized");
    await expect(
      share.write.setIssuer([relayer.account.address], { account: relayer.account }),
    ).to.be.rejectedWith("Unauthorized");
  });

  it("burns a redemption and blocks its replay", async () => {
    const { share, admin, relayer, investor } = await deploy();
    await share.write.setInvestorPermission([investor.account.address, true], { account: admin.account });
    await share.write.settleSubscription(
      [settlementKey("subscription", "sub_1", "mint_subscription"), investor.account.address, SHARES],
      { account: relayer.account },
    );

    const redeemId = settlementKey("redemption", "red_1", "burn_redemption");
    await share.write.settleRedemption([redeemId, investor.account.address, SHARES], {
      account: relayer.account,
    });
    expect(await share.read.totalSupply()).to.equal(0n);

    await expect(
      share.write.settleRedemption([redeemId, investor.account.address, SHARES], {
        account: relayer.account,
      }),
    ).to.be.rejectedWith("SettlementAlreadyProcessed");
  });

  it("stops settlement while paused", async () => {
    const { share, admin, relayer, investor } = await deploy();
    await share.write.setInvestorPermission([investor.account.address, true], { account: admin.account });
    await share.write.pause({ account: admin.account });
    await expect(
      share.write.settleSubscription(
        [settlementKey("subscription", "sub_paused", "mint_subscription"), investor.account.address, SHARES],
        { account: relayer.account },
      ),
    ).to.be.rejectedWith("ContractPaused");
  });

  it("restricts transfers to allowlisted holders on both sides", async () => {
    const { share, admin, relayer, investor, outsider } = await deploy();
    await share.write.setInvestorPermission([investor.account.address, true], { account: admin.account });
    await share.write.settleSubscription(
      [settlementKey("subscription", "sub_2", "mint_subscription"), investor.account.address, SHARES],
      { account: relayer.account },
    );

    const asInvestor = await hre.viem.getContractAt("GanymedeFundShare", share.address, {
      client: { wallet: investor },
    });
    await expect(
      asInvestor.write.transfer([outsider.account.address, SHARES]),
    ).to.be.rejectedWith("TransferRestricted");
  });
});
