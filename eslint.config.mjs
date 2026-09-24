import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and Hardhat's generated artifacts.
    "dist/**",
    ".wrangler/**",
    "onchain/artifacts/**",
    "onchain/cache/**",
    "relayer/.wrangler/**",
    // Local scratch folders (git-ignored).
    "work/**",
    "outputs/**",
  ]),
]);

export default eslintConfig;
