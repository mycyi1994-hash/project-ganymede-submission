/**
 * USTX usage from the fund's deployment to block 42548205, read once from X Layer Testnet on 3 October 2026
 * (every event of the fund, both pools and the lending market). The activity cron carries it forward.
 */
import type { Usage } from "./usage";

export const USAGE_SEED: Usage = {
  "fromBlock": 41844113,
  "toBlock": 42548205,
  "wallets": {
    "0x4a1281dcb6a4f299c1eb520b65b9a0a2f15fb5f2": {
      "firstAt": "2026-09-25T02:23:26.000Z",
      "lastAt": "2026-09-25T18:38:48.000Z",
      "actions": 66,
      "volumeMicros": "3468000755"
    },
    "0x106bab5df04f9ea247372b29d7cb1c4b03152ca1": {
      "firstAt": "2026-09-25T12:17:35.000Z",
      "lastAt": "2026-09-25T12:18:59.000Z",
      "actions": 4,
      "volumeMicros": "2000000000"
    }
  },
  "kinds": {
    "invest": {
      "all": 52,
      "outside": 14
    },
    "redeem": {
      "all": 40,
      "outside": 5
    },
    "addLiquidity": {
      "all": 34,
      "outside": 0
    },
    "sell": {
      "all": 42,
      "outside": 10
    },
    "arbitrage": {
      "all": 21,
      "outside": 1
    },
    "buy": {
      "all": 43,
      "outside": 9
    },
    "lend": {
      "all": 13,
      "outside": 1
    },
    "deposit": {
      "all": 42,
      "outside": 9
    },
    "borrow": {
      "all": 41,
      "outside": 8
    },
    "repay": {
      "all": 39,
      "outside": 6
    },
    "withdrawCollateral": {
      "all": 40,
      "outside": 7
    },
    "v4Deposit": {
      "all": 2,
      "outside": 0
    },
    "v4Buy": {
      "all": 35,
      "outside": 0
    },
    "v4Sell": {
      "all": 33,
      "outside": 0
    },
    "removeLiquidity": {
      "all": 33,
      "outside": 0
    },
    "withdraw": {
      "all": 12,
      "outside": 0
    }
  },
  "team": {
    "actions": 452,
    "volumeMicros": "23464005450"
  }
};
