import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Settlement rails, keyed by Hardhat network name. `key` matches
 * SETTLEMENT_CHAIN in the app and the relayer (lib/chains.ts,
 * relayer/src/chain.ts) and names the deployment record.
 */
export const RAILS = {
  xlayerTestnet: {
    key: "xlayer-testnet",
    name: "X Layer Testnet",
    chainId: 1952,
    rpcUrl: "https://testrpc.xlayer.tech/terigon",
    explorer: "https://www.okx.com/web3/explorer/xlayer-test",
    gasToken: "OKB",
  },
  giwaSepolia: {
    key: "giwa-sepolia",
    name: "GIWA Sepolia",
    chainId: 91342,
    rpcUrl: "https://sepolia-rpc.giwa.io",
    explorer: "https://sepolia-explorer.giwa.io",
    gasToken: "ETH",
  },
} as const;

export type Rail = (typeof RAILS)[keyof typeof RAILS];

export function railFor(network: string): Rail {
  const rail = RAILS[network as keyof typeof RAILS];
  if (!rail) {
    throw new Error(`Network "${network}" is not a settlement rail. Use --network ${Object.keys(RAILS).join(" | ")}.`);
  }
  return rail;
}

export interface Deployment {
  chainId: number;
  network: string;
  explorer: string;
  deployedAt: string;
  admin: string;
  relayer: string;
  contracts: {
    GanymedeFundShare: {
      address: string;
      productId: string;
      name: string;
      symbol: string;
      constructorArgs: unknown[];
    };
    GanymedeNavRegistry: { address: string; constructorArgs: unknown[] };
    // Wallet investing on X Layer Testnet (scripts/deploy-fund.ts), deployed later.
    GanymedeDemoDollar?: { address: string; deployedAt: string; constructorArgs: unknown[] };
    GanymedeBasketFund?: {
      address: string;
      deployedAt: string;
      productId: string;
      name: string;
      symbol: string;
      constructorArgs: unknown[];
    };
    // The USTX NAV in the AggregatorV3Interface shape (scripts/deploy-feed.ts).
    GanymedeNavFeed?: {
      address: string;
      deployedAt: string;
      deploymentTransaction: string;
      productId: string;
      description: string;
      constructorArgs: unknown[];
    };
    // Lending against USTX (scripts/deploy-lending.ts). Written and tested; not deployed.
    GanymedeLendingMarket?: { address: string; deployedAt: string; constructorArgs: unknown[] };
  };
}

export function deploymentPath(rail: Rail): string {
  return join(__dirname, "..", "deployments", `${rail.key}.json`);
}

export function loadDeployment(rail: Rail): Deployment {
  const path = deploymentPath(rail);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Deployment;
  } catch {
    throw new Error(`No deployment record at ${path}. Run \`npm run deploy\` first.`);
  }
}
