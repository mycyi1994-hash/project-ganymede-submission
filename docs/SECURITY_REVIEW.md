# Dependency review — 24 September 2026

Scope: the root application dependency tree. This is not a penetration test or a smart-contract audit.

The final review updated Next.js to 16.3.6, React/React DOM/React Server DOM to 19.2.8, Vite to 8.3.0, the Cloudflare Vite plugin to 1.58.0 and Wrangler to 4.137.0. Compatible transitive updates were applied. The existing vinext 0.0.50 is retained, with its image-size dependency overridden to the API-compatible 2.0.4 patch to address parser denial-of-service advisories.

Root npm audit after these changes reports no critical or high vulnerabilities and four moderate dependency-tree findings. These are the same esbuild development-server advisory propagated through @esbuild-kit/core-utils, @esbuild-kit/esm-loader and drizzle-kit. This tool is used to generate schemas, not to serve the deployed Worker. Do not expose its development server to untrusted sites. npm's suggested forced change downgrades drizzle-kit across versions and was not applied.

The onchain and relayer package trees were not updated in this pass. Contracts remain unaudited. No claim of complete security or exploitability assessment is made.
