"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isAddress, sharedWalletAccount } from "@/lib/product-ledger";

type WalletState = { address: string; source: "wallet" | "watch"; busy: boolean; message: string; connect: () => Promise<void>; watch: (address: string) => boolean; clearWatch: () => void };
const Context = createContext<WalletState | null>(null);
const WATCH_KEY = "ganymede-public-ledger-address";

export function WalletAccountProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState("");
  const [source, setSource] = useState<"wallet" | "watch">("wallet");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const revision = useRef(0);
  const alive = useRef(true);
  const activeSource = useRef<"wallet" | "watch">("wallet");
  const remember = (value: string) => { try { if (value) sessionStorage.setItem(WATCH_KEY, value); else sessionStorage.removeItem(WATCH_KEY); } catch { /* A public address is optional browser convenience. */ } };
  const apply = useCallback((value: unknown) => {
    revision.current += 1;
    activeSource.current = "wallet";
    setAddress(sharedWalletAccount(value)); setSource("wallet"); setMessage(""); remember("");
  }, []);
  useEffect(() => {
    alive.current = true;
    let watchAddress = "";
    try { watchAddress = sessionStorage.getItem(WATCH_KEY) ?? ""; } catch { /* Storage can be disabled. */ }
    const provider = window.okxwallet ?? window.ethereum;
    const expected = revision.current;
    // Queue initial state; do not show one account while reading another.
    if (isAddress(watchAddress)) {
      activeSource.current = "watch";
      queueMicrotask(() => { if (alive.current && expected === revision.current) { setAddress(watchAddress.toLowerCase()); setSource("watch"); } });
    } else if (provider) {
      void provider.request({ method: "eth_accounts" }).then(value => { if (alive.current && expected === revision.current) apply(value); }).catch(() => {});
    }
    const changed = (...args: unknown[]) => { if (alive.current && activeSource.current === "wallet") apply(args[0]); };
    const disconnected = () => { if (alive.current && activeSource.current === "wallet") apply([]); };
    provider?.on?.("accountsChanged", changed); provider?.on?.("disconnect", disconnected);
    return () => { alive.current = false; revision.current += 1; provider?.removeListener?.("accountsChanged", changed); provider?.removeListener?.("disconnect", disconnected); };
  }, [apply]);
  async function connect() {
    if (busy) return;
    const provider = window.okxwallet ?? window.ethereum;
    setMessage("");
    if (!provider) { setMessage("Open this site in your wallet browser, or view a public address below."); return; }
    const expected = ++revision.current;
    setBusy(true);
    try {
      const value = await provider.request({ method: "eth_requestAccounts" });
      if (alive.current && expected === revision.current) {
        apply(value);
        if (!sharedWalletAccount(value)) setMessage("No account was shared. You can try again.");
      }
    } catch (error) {
      if (alive.current && expected === revision.current) setMessage((error as { code?: number }).code === 4001 ? "Connection cancelled. You can keep browsing." : "Connection could not finish. Check your wallet and try again.");
    } finally { if (alive.current) setBusy(false); }
  }
  function watch(value: string) {
    if (!isAddress(value.trim())) { setMessage("Enter a valid public EVM address (0x followed by 40 characters)."); return false; }
    revision.current += 1;
    const normalized = value.trim().toLowerCase();
    activeSource.current = "watch";
    setAddress(normalized); setSource("watch"); setMessage(""); remember(normalized); return true;
  }
  function clearWatch() {
    revision.current += 1;
    activeSource.current = "wallet";
    setAddress(""); setSource("wallet"); setMessage(""); remember("");
  }
  return <Context.Provider value={{ address, source, busy, message, connect, watch, clearWatch }}>{children}</Context.Provider>;
}

export function useWalletAccount() {
  const state = useContext(Context);
  if (!state) throw new Error("Wallet account provider is required.");
  return state;
}
