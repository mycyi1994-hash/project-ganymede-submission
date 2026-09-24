/**
 * Writes everything the explorer's manual "Verify and publish" form asks for,
 * so source verification needs no explorer API key.
 *
 * For each deployed contract, in deployments/verification/<rail>/:
 *   <Contract>.standard-input.json   the exact solc Standard JSON input
 *   <Contract>.txt                   address, compiler version, contract name,
 *                                    ABI-encoded constructor arguments
 *
 * Run: npm run verify:export          (X Layer testnet)
 *      npm run verify:export:giwa     (GIWA Sepolia)
 */
import hre from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, type AbiParameter } from "viem";
import { loadDeployment, railFor } from "./_deployment";

const CONTRACTS = {
  GanymedeFundShare: "contracts/GanymedeFundShare.sol:GanymedeFundShare",
  GanymedeNavRegistry: "contracts/GanymedeNavRegistry.sol:GanymedeNavRegistry",
} as const;

async function main() {
  const rail = railFor(hre.network.name);
  const deployment = loadDeployment(rail);
  const outDir = join(__dirname, "..", "deployments", "verification", rail.key);
  mkdirSync(outDir, { recursive: true });

  for (const [name, fullyQualifiedName] of Object.entries(CONTRACTS) as Array<[keyof typeof CONTRACTS, string]>) {
    const buildInfo = await hre.artifacts.getBuildInfo(fullyQualifiedName);
    if (!buildInfo) throw new Error(`No build info for ${fullyQualifiedName}. Run \`npm run build\` first.`);
    const artifact = await hre.artifacts.readArtifact(fullyQualifiedName);
    const constructor = artifact.abi.find((item: { type: string }) => item.type === "constructor") as { inputs: AbiParameter[] } | undefined;
    const record = deployment.contracts[name];
    const encodedArgs = constructor
      ? encodeAbiParameters(constructor.inputs, record.constructorArgs as never[]).slice(2)
      : "";

    writeFileSync(join(outDir, `${name}.standard-input.json`), `${JSON.stringify(buildInfo.input, null, 2)}\n`);
    writeFileSync(
      join(outDir, `${name}.txt`),
      [
        `network               ${rail.name} (chain ${rail.chainId})`,
        `address               ${record.address}`,
        `explorer              ${rail.explorer}/address/${record.address}`,
        `contract name         ${fullyQualifiedName}`,
        `compiler              v${buildInfo.solcLongVersion}`,
        `optimizer             ${buildInfo.input.settings.optimizer?.enabled ? `enabled, ${buildInfo.input.settings.optimizer?.runs} runs` : "disabled"}`,
        `evm version           ${buildInfo.input.settings.evmVersion ?? "compiler default"}`,
        `license               MIT`,
        `constructor args      ${encodedArgs || "(none)"}`,
        "",
      ].join("\n"),
    );
    console.log(`${name.padEnd(20)} ${record.address}`);
  }
  console.log(`\nwrote ${outDir}`);
  console.log("Upload <Contract>.standard-input.json with \"Standard JSON input\" on the explorer's verify page,");
  console.log("then paste the constructor args from <Contract>.txt.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
