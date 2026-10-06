/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { runUstxNavCycle } from "../lib/engine/runner";
import type { EngineEnv } from "../lib/engine/types";
import { ACTIVITY_CRON, runActivityIndex, runLpMarkout } from "../lib/xstocks/activity-index";
import { POOLS_CRON, runPoolsSnapshot } from "../lib/xstocks/pools-api";
import { runNavSnapshot } from "../lib/xstocks/nav-api";
import { runDexQuotes } from "../lib/xstocks/dex-quotes";

interface Env extends EngineEnv {
  ASSETS: Fetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

// A fresh nonce for every request, on every script the pages write. The script policy built on it
// (this site's own files, or inline with the nonce) is reported, not yet enforced: enforced, it also
// refuses eval in a wallet's injected provider (measured with a test extension), so it waits for a
// test with OKX Wallet itself, in the extension and in the OKX app. ('strict-dynamic' would also
// refuse the module preloads React writes without the nonce.)
function scriptNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

const scriptPolicy = (nonce: string) => `script-src 'self' 'nonce-${nonce}'`;

// vinext puts the nonce of the request's Content-Security-Policy header on every inline script it
// writes, and the root layout reads x-nonce for its own; both are set here, whatever the client sent.
function withNonce(request: Request, nonce: string): Request {
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", scriptPolicy(nonce));
  headers.set("x-nonce", nonce);
  return new Request(request, { headers });
}

// Headers on every response. Pages refuse to be framed, so another site cannot lay its own page
// over a wallet prompt; the badges under /embed/ are made to be framed anywhere.
function withSecurityHeaders(response: Response, pathname: string, nonce: string): Response {
  const embeddable = pathname.startsWith("/embed/");
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Content-Security-Policy", `frame-ancestors ${embeddable ? "*" : "'none'"}; base-uri 'self'; object-src 'none'; form-action 'self'`);
  headers.set("Content-Security-Policy-Report-Only", scriptPolicy(nonce));
  if (embeddable) headers.delete("X-Frame-Options");
  else headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const nonce = scriptNonce();

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return withSecurityHeaders(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths), url.pathname, nonce);
    }

    // Public reads must not consume the database's write budget or start trades.
    // Pricing runs on the cron schedule or through the authenticated operator API.
    return withSecurityHeaders(await handler.fetch(withNonce(request, nonce), env, ctx), url.pathname, nonce);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DB) {
      controller.noRetry();
      return;
    }
    // Snapshots for the public NAV and pools APIs, every minute, apart from the NAV record; each
    // job apart, so a failure in one leaves the other.
    if (controller.cron === POOLS_CRON) {
      ctx.waitUntil(runPoolsSnapshot(env).catch((error) => {
        console.error("Ganymede pools snapshot failed", error);
        throw error;
      }));
      ctx.waitUntil(runNavSnapshot(env).catch((error) => {
        console.error("Ganymede NAV snapshot failed", error);
        throw error;
      }));
      return;
    }
    // Market activity has a cron of its own, so its reads never hold up the NAV record.
    if (controller.cron === ACTIVITY_CRON) {
      ctx.waitUntil(runActivityIndex(env).catch((error) => {
        console.error("Ganymede market activity run failed", error);
        throw error;
      }));
      // The pools' results for their providers: apart, so a failure in either leaves the other.
      ctx.waitUntil(runLpMarkout(env).catch((error) => {
        console.error("Ganymede pool results run failed", error);
        throw error;
      }));
      // OKX DEX quotes for building the basket by hand, once an hour (lib/xstocks/dex-quotes.ts).
      ctx.waitUntil(runDexQuotes(env).then((quotes) => {
        if (quotes) console.log("Ganymede DEX quotes", quotes.error ?? `${quotes.legs.length} legs`);
      }).catch((error) => {
        console.error("Ganymede DEX quotes failed", error);
        throw error;
      }));
      return;
    }
    // The USTX NAV record only: the earlier engine's paper strategies run through the operator API.
    ctx.waitUntil(runUstxNavCycle(env).catch((error) => {
      console.error("Ganymede scheduled NAV record failed", error);
      throw error;
    }));
  },
};

export default worker;
