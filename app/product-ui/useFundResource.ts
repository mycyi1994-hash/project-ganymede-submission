"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO_ORDER_EVENT } from "@/lib/demo/format";

/** Refresh after orders/reset and on return; an older response cannot undo a refresh. */
export function useFundResource<T>(url: string) {
  const [state, setState] = useState<{ url: string; data: T | null; error: string | null }>({ url, data: null, error: null });
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const replace = useCallback((data: T) => {
    generation.current++;
    setState({ url, data, error: null });
  }, [url]);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The funds could not be read just now.");
      if (request === generation.current) setState({ url, data: body as T, error: null });
    } catch (error) {
      if (request === generation.current) setState({ url, data: null, error: error instanceof Error ? error.message : "The funds could not be read just now." });
    }
  }, [url]);
  useEffect(() => {
    const refresh = () => { void reload(); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener(DEMO_ORDER_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      invalidate();
      window.clearInterval(timer);
      window.removeEventListener(DEMO_ORDER_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [reload, invalidate]);
  return { data: state.url === url ? state.data : null, error: state.url === url ? state.error : null, reload, replace };
}
