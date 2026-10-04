/** The 30 wallets of the testnet load test (docs/LOAD_TEST.md, onchain/scripts/stress-testnet.ts). */
const LOAD_TEST_WALLETS = [
  "0x113e68345861f71e5823f0636b755ebecd0216e8",
  "0x35d9819a955cb1dc25324da0f546239dcf3b5173",
  "0x1f630b67b8d0b681af41e0f51f4b364769cf1eba",
  "0xab910edd384bcedd5c45cd943c2f89650d2d4e5e",
  "0xad98e1d4c8728b931c802562c0a22a876ec8e425",
  "0x99e2dc00be54ab6fa65f38fac9c166aa211b97d2",
  "0xa69227811884d7f915655428aaf23a07b39322a6",
  "0x072f41c0ef90bc5fcc6d8e38f5e72e0aecc9866d",
  "0xad8ea07914f954d4da8314eb3b2481043c9a9b88",
  "0xee014a74edf56bfbc1cb6715975232925108659c",
  "0xb1610c5489ceaccda3dbdecedaec7f5d2ea3dbc9",
  "0xb1b2fdb075dec1fc3a78922dc7f58c3ed17c78c4",
  "0x5803c1c05e0fc400b76f119bd9824b1d62bd6921",
  "0xe7f60b3a35ef00d7c494d0569a454f65858db088",
  "0x922f9317c03b57a26f8e6435f0be018e54723a61",
  "0x96d1fc2557630e189b5344524c987a483d80aec0",
  "0xf36ee64723f79b7f0e8b3c2841d5c6ef63f6fa51",
  "0x85c78b98b57b14f47b474920197805ac098d97e9",
  "0xb7a76ddd1ceef40969682e15a60bc6a8bad49a79",
  "0xf2d416288174fddc6e0f6f4d870375ce3d74832b",
  "0x48c7b1e7f2fa8612de1464bfaad895bd6921a2a2",
  "0xde667a33f070d116ebde2978cea25aae292697bb",
  "0x893239c88958ce8b6fc9551abf580b49f0a9b12a",
  "0xdf42c07a014b6a7f70ea390287a8e199c3385b38",
  "0x33f2cc2629d9fca39daa40d5b3c6718ca18670c5",
  "0xaa709b6c50aae223824133a5d42ed9f8f2e66f1c",
  "0x0a5c9d0bdc5d3357be88e39c8fcff41741878785",
  "0xca362664d0611bbc07583b4be53f8afbc030eea3",
  "0x6232dad717b0480421878f8a971faeb3a85fa803",
  "0xf9db4429f818f37f844d45de9ef74d6411c17e07",
];

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
