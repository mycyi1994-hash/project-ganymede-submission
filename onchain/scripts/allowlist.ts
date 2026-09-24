/**
 * Allowlists investor wallets on the fund share ledger.
 *
 * This runs under the ADMIN key on purpose. Allowlisting is a compliance
 * decision (in production: KYC/AML, plus Upbit Korea Dojang Verified Address
 * on GIWA), so the relayer deliberately has no permission to do it. On X Layer
 * this allowlist is also what the relayer's /v1/eligibility check reads. If a mint fails with
 * `investor_not_allowlisted`, this script is the intended remedy.
 *
 * Run: WALLETS=0xabc...,0xdef... npm run allowlist         (X Layer testnet)
 *      WALLETS=0xabc...,0xdef... npm run allowlist:giwa    (GIWA Sepolia)
 */
import hre from "hardhat";
import { getAddress, type Address } from "viem";
import { loadDeployment, railFor } from "./_deployment";

async function main() {
  const wallets = (process.env.WALLETS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (wallets.length === 0) {
    throw new Error("Set WALLETS to a comma-separated list of investor addresses.");
  }

  const normalized: Address[] = wallets.map((wallet) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error(`not an EVM address: ${wallet}`);
    return getAddress(wallet);
  });

  const deployment = loadDeployment(railFor(hre.network.name));
  const [admin] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  if (getAddress(admin.account.address) !== getAddress(deployment.admin)) {
    throw new Error(
      `This script must run as the administrator (${deployment.admin}), got ${admin.account.address}.`,
    );
  }

  const share = await hre.viem.getContractAt(
    "GanymedeFundShare",
    deployment.contracts.GanymedeFundShare.address as Address,
    { client: { wallet: admin } },
  );

  const hash = await share.write.setInvestorPermissions([normalized, true], { account: admin.account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`allowlisted ${normalized.length} wallet(s) in block ${receipt.blockNumber}`);
  console.log(`${deployment.explorer}/tx/${hash}`);

  for (const wallet of normalized) {
    const allowed = await share.read.isAllowed([wallet]);
    console.log(`  ${allowed ? "ok " : "FAIL"} ${wallet}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
