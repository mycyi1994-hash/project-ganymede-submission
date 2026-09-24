"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { decodeMarketSnapshot, type MarketSnapshot } from "@/lib/product-market";

type MarketContext = { data: MarketSnapshot | null; error: string; loading: boolean; now: number; reload: () => void };
const Context = createContext<MarketContext | null>(null);

export function MarketProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);
  const [now, setNow] = useState(0);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 15_000);
    setLoading(true);
    setNow(Date.now());
    try {
      const response = await fetch("/api/xstocks", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("The market could not be refreshed.");
      const next = decodeMarketSnapshot(await response.json());
      if (active.current === controller && !controller.signal.aborted) { setData(next); setError(""); }
    } catch {
      if (active.current === controller && (!controller.signal.aborted || controller.signal.reason === "timeout")) setError("Market data is unavailable. Please try again.");
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) setLoading(false);
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { setNow(Date.now()); if (!document.hidden) void load(); }, 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); active.current?.abort(); active.current = null; };
  }, [load, enabled]);
  return <Context.Provider value={{ data, error, loading, now, reload: () => void load() }}>{children}</Context.Provider>;
}

export function useMarket() {
  const value = useContext(Context);
  if (!value) throw new Error("MarketProvider is required");
  return value;
}
