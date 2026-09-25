/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { runUstxNavCycle } from "../lib/engine/runner";
import type { EngineEnv } from "../lib/engine/types";
import { ACTIVITY_CRON, runActivityIndex } from "../lib/xstocks/activity-index";

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

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    // Public reads must not consume the database's write budget or start trades.
    // Pricing runs on the cron schedule or through the authenticated operator API.
    return handler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DB) {
      controller.noRetry();
      return;
    }
    // Market activity has a cron of its own, so its reads never hold up the NAV record.
    if (controller.cron === ACTIVITY_CRON) {
      ctx.waitUntil(runActivityIndex(env).catch((error) => {
        console.error("Ganymede market activity run failed", error);
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
