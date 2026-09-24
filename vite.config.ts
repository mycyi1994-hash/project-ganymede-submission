import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Sites fills in the worker and database at deploy time. A direct
// `wrangler deploy` to Cloudflare Workers names them here instead.
const workerName = process.env.CLOUDFLARE_WORKER_NAME;
const d1DatabaseName = process.env.CLOUDFLARE_D1_DATABASE_NAME;
const d1DatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;

const localBindingConfig = {
  ...(workerName ? { name: workerName } : {}),
  main: "./worker/index.ts",
  // global_fetch_strictly_public lets the engine reach a settlement relayer
  // Worker on the same Cloudflare account through its workers.dev URL, which
  // otherwise fails with Cloudflare error 1042.
  compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: d1DatabaseName || "site-creator-d1",
          database_id: d1DatabaseId || SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  triggers: {
    crons: ["*/5 * * * *"],
  },
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
