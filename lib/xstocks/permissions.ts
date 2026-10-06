/**
 * Who controls each USTX contract on X Layer Testnet, read from the contracts themselves: the
 * administrator, the record publisher, the dUSD minter and whether the contract is paused, with what
 * each role can and cannot do by the contracts' verified source. A reader can check every line on
 * the OKX explorer; nothing here is taken from this server.
 */
import { PROOF_DEPLOYMENT } from "./proof";
import { FUND_DEPLOYMENT, call, type Rpc } from "./fund";
import { V4_POOL_DEPLOYMENT } from "./v4-liquidity";
import { RANGE_POOL_DEPLOYMENT } from "./range-liquidity";

export const PERMISSION_SELECTORS = { administrator: "0xf53d0a8e", pendingAdministrator: "0x6a75f3a0", paused: "0x5c975abb", publisher: "0x8c72c54e", minter: "0x07546172", owner: "0x8da5cb5b" } as const;

type Role = "administrator" | "pendingAdministrator" | "publisher" | "minter" | "owner";
export type ContractControl = {
  name: string;
  address: string;
  roles: { label: string; holder: string | null }[];
  pausable: boolean;
  /** Null when the contract cannot be paused or the read failed. */
  paused: boolean | null;
  can: string;
  cannot: string;
};

/** Addresses the app knows by name. */
export const KNOWN_ADDRESSES: Record<string, string> = {
  "0x107633a3aa88c81d4c47d01992e089573e2e87c9": "Ganymede administrator",
  "0x1d779c2337036b4e9ecb8a5533e456b14b799108": "Settlement relayer",
  [FUND_DEPLOYMENT.fund]: "USTX fund contract",
  [FUND_DEPLOYMENT.keeper]: "Arbitrage keeper",
};

type Spec = { name: string; address: string; roles: [string, Role][]; pausable: boolean; can: string; cannot: string };

export function controlSpecs(): Spec[] {
  const specs: Spec[] = [
    { name: "NAV registry", address: PROOF_DEPLOYMENT.registry, roles: [["Administrator", "administrator"], ["Publisher", "publisher"]], pausable: true,
      can: "The publisher adds NAV records. The administrator can pause new records, name the publisher, and hand over administration in two steps.",
      cannot: "No function edits or deletes a record once published." },
    { name: "USTX fund", address: FUND_DEPLOYMENT.fund, roles: [["Administrator", "administrator"]], pausable: true,
      can: "The administrator can pause investing and redeeming, and hand over administration in two steps.",
      cannot: "Nobody can issue USTX except by investing at the latest recorded NAV, change that NAV, or move a holder's USTX." },
    { name: "dUSD demo dollar", address: FUND_DEPLOYMENT.dollar, roles: [["Administrator", "administrator"], ["Minter", "minter"]], pausable: false,
      can: "Anyone can claim demo dollars once a day. The minter (the USTX fund) issues them for redemptions; the administrator names the minter.",
      cannot: "dUSD has no value and cannot be exchanged for money." },
    { name: "Lending market", address: FUND_DEPLOYMENT.lending, roles: [["Administrator", "administrator"]], pausable: true,
      can: "The administrator can pause new lending and borrowing, and hand over administration in two steps.",
      cannot: "A pause never blocks repaying, withdrawing or liquidating, and nobody can move a depositor's USTX or demo dollars." },
    { name: "USTX/dUSD pool", address: FUND_DEPLOYMENT.pool, roles: [], pausable: false,
      can: "Trades and liquidity at the pool's own rules.", cannot: "It has no administrator: nobody can pause it, change its fee or move its liquidity." },
    { name: "NAV arbitrage", address: FUND_DEPLOYMENT.arbitrage, roles: [], pausable: false,
      can: "Anyone can close the pool's gap to the NAV through the fund in one transaction.", cannot: "It has no administrator and holds nothing between trades." },
    { name: "NAV feed", address: FUND_DEPLOYMENT.feed, roles: [], pausable: false,
      can: "Serves the registry's latest USTX NAV in the Chainlink interface.", cannot: "It has no owner and nothing to configure." },
  ];
  if (V4_POOL_DEPLOYMENT) {
    specs.push(
      { name: "Uniswap v4 hook", address: V4_POOL_DEPLOYMENT.hook, roles: [], pausable: false,
        can: "Moves its pool to each NAV record and holds the liquidity for its depositors.", cannot: "It has no administrator: only Uniswap's PoolManager can call its hooks, and nobody can move depositors' liquidity." },
      { name: "Uniswap v4 router", address: V4_POOL_DEPLOYMENT.router, roles: [], pausable: false,
        can: "Swaps on a Uniswap v4 pool for whoever calls it, with the least they accept and a deadline.", cannot: "It has no owner and holds nothing between transactions." },
      { name: "Uniswap v4 PoolManager", address: V4_POOL_DEPLOYMENT.poolManager, roles: [["Owner", "owner"]], pausable: false,
        can: "Uniswap v4-core as published. Its owner can set Uniswap's protocol fee, which this deployment leaves at zero.", cannot: "The owner cannot move pool liquidity or change the hook." },
    );
  }
  if (RANGE_POOL_DEPLOYMENT) {
    specs.push(
      { name: "Range pool hook", address: RANGE_POOL_DEPLOYMENT.hook, roles: [], pausable: false,
        can: "Opens each provider's bins near the NAV and closes them for their owner at any time, with their tokens and fees.", cannot: "It has no administrator and no pause: only Uniswap's PoolManager can call its hooks, nobody can move another provider's position, and no swap may leave the price more than about 5% from the NAV." },
      { name: "Range pool arbitrage", address: RANGE_POOL_DEPLOYMENT.arbitrage, roles: [], pausable: false,
        can: "Anyone can bring the range pool back to the NAV through the fund in one transaction.", cannot: "It has no administrator, holds nothing between trades and takes demo dollars only from its caller." },
    );
  }
  return specs;
}

const asAddress = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length < 66) return null;
  const address = `0x${value.slice(-40)}`.toLowerCase();
  return /^0x0{40}$/.test(address) ? null : address;
};
const asBool = (value: unknown): boolean | null => typeof value === "string" && value.length >= 66 ? BigInt(value) !== 0n : null;

/** Every contract's roles and pause state, read at one block. A read that fails is null. */
export async function readControls(rpc: Rpc, block = "latest"): Promise<ContractControl[]> {
  const specs = controlSpecs();
  return Promise.all(specs.map(async spec => {
    const [roles, paused] = await Promise.all([
      Promise.all(spec.roles.map(async ([label, role]) => ({ label, holder: asAddress(await call(rpc, spec.address, PERMISSION_SELECTORS[role], block).catch(() => null)) }))),
      spec.pausable ? call(rpc, spec.address, PERMISSION_SELECTORS.paused, block).then(asBool).catch(() => null) : Promise.resolve(null),
    ]);
    return { name: spec.name, address: spec.address, roles, pausable: spec.pausable, paused, can: spec.can, cannot: spec.cannot };
  }));
}
