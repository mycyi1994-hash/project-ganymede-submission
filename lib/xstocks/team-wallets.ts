import { LOAD_TEST_WALLETS } from "./load-test-wallets";

/**
 * Wallets run by the Ganymede team or its tests, left out of the usage figures
 * (lib/xstocks/usage.ts) so they show only what other wallets did. Addresses only; no key is kept here.
 */
export const TEAM_WALLETS: Record<string, string> = {
  "0x107633a3aa88c81d4c47d01992e089573e2e87c9": "Ganymede administrator",
  "0x1d779c2337036b4e9ecb8a5533e456b14b799108": "Settlement relayer",
  "0xccf372068496d9bef0f7cf83d697183d358dec1b": "Arbitrage keeper",
  "0xdc73d6c2ec5cb619a19dc6b66de39a85d9f04145": "Test OKB faucet",
  "0xb50794e6181e3311d6ae211e3dd7723e9e66af31": "End-to-end test wallet",
  ...Object.fromEntries(LOAD_TEST_WALLETS.map((address, index) => [address, `Load-test wallet ${index + 1}`])),
};
