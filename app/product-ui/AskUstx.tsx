"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icons";

// Ask USTX: an AI guide at the top of every product screen, with what is happening now and the next
// questions and steps for that screen, and the conversation panel it opens. Answers come from
// POST /api/assistant, which reads X Layer through the same read-only tools as the MCP server; each
// answer names the tools it read. The guide's line of figures is read from the public API, not the model.

type Turn = { role: "user" | "assistant"; content: string; tools?: string[] };

const TOOL_LABELS: Record<string, string> = {
  get_ustx_nav: "published NAV",
  verify_ustx_nav: "price verification",
  get_ustx_holdings: "holdings",
  quote_ustx_order: "fund and pool quotes",
  get_ustx_pools: "pools",
  get_ustx_market_activity: "market activity",
};

type AskApi = { ask: (question: string) => void };
const AskContext = createContext<AskApi | null>(null);

/** Asks Ask USTX a question from anywhere on a product screen, opening the conversation; null outside the shell. */
export function useAsk(): AskApi | null { return useContext(AskContext); }

/** Holds the conversation for the whole page, so the guide on any screen can start or continue it. */
export function AskProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const state = useRef({ turns, busy });
  state.current = { turns, busy };

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  // Escape closes the panel wherever focus is, even after a button inside it has gone away.
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [turns, busy]);

  const ask = useCallback(async (question: string) => {
    const text = question.trim();
    setOpen(true);
    const { turns: before, busy: running } = state.current;
    if (!text || running) return;
    const next: Turn[] = [...before, { role: "user", content: text }];
    setTurns(next);
    setDraft("");
    setError(null);
    setBusy(true);
    let answer = "";
    const read: string[] = [];
    try {
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ messages: next.slice(-12).map(({ role, content }) => ({ role, content })) }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
        const customerMessage = response.status === 429 || body.code === "too_long";
        throw new Error(customerMessage && body.error ? body.error : "Ask USTX is unavailable right now. Please try again.");
      }
      // One event per line: a tool being read, a piece of the answer, the end or an error.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          if (!line) continue;
          const event = JSON.parse(line) as { type: string; name?: string; text?: string; answer?: string; toolsUsed?: string[]; message?: string };
          if (event.type === "tool" && event.name) {
            if (!read.includes(event.name)) read.push(event.name);
            setReading(TOOL_LABELS[event.name] ?? "market data");
          } else if (event.type === "delta" && event.text) {
            answer += event.text;
            setReading(null);
            setTurns([...next, { role: "assistant", content: answer, tools: read }]);
          } else if (event.type === "done") {
            finished = true;
            setTurns([...next, { role: "assistant", content: event.answer ?? answer, tools: event.toolsUsed ?? read }]);
          } else if (event.type === "error") {
            throw new Error(event.message || "The assistant is unavailable right now.");
          }
        }
      }
      if (!finished) throw new Error("The answer was cut off. Try again.");
    } catch (failure) {
      setError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : "Ask USTX could not connect. Please try again.");
      if (!answer) { setTurns(before); setDraft(text); }
    } finally {
      setReading(null);
      setBusy(false);
    }
  }, []);

  return <AskContext.Provider value={{ ask: question => void ask(question) }}>
    {children}
    {open && <section className="gmd-ask" role="dialog" aria-label="Ask USTX">
      <header><div><strong><Icon name="spark" size={17} />Ask USTX</strong><span>Prices, holdings and your next step</span></div>
        <div>{turns.length > 0 && <button type="button" className="gmd-ask-reset" onClick={() => { setTurns([]); setError(null); input.current?.focus(); }}>New chat</button>}<button type="button" aria-label="Close Ask USTX" onClick={() => setOpen(false)}><Icon name="close" size={18} /></button></div>
      </header>
      <div className="gmd-ask-log" ref={log} aria-live="polite">
        {turns.length === 0 && <div className="gmd-ask-intro"><p>Ask about USTX&rsquo;s NAV, what a share holds, quotes at the fund and the pools, or how the record is checked.</p></div>}
        {turns.map((turn, index) => <div key={index} className={`gmd-ask-turn is-${turn.role}`}>
          <p>{turn.content}</p>
          {turn.role === "assistant" && turn.tools && turn.tools.length > 0 && <small><Icon name="check" size={13} />Read from {turn.tools.map(tool => TOOL_LABELS[tool] ?? "market data").join(", ")}</small>}
        </div>)}
        {busy && turns[turns.length - 1]?.role !== "assistant" && <div className="gmd-ask-turn is-assistant is-busy"><p>{reading ? `Reading the ${reading}…` : "Reading X Layer…"}</p></div>}
        {error && <p className="gmd-ask-error" role="alert">{error}</p>}
      </div>
      <form onSubmit={event => { event.preventDefault(); void ask(draft); }}>
        <label className="gmd-sr-only" htmlFor="gmd-ask-input">Your question</label>
        <textarea id="gmd-ask-input" ref={input} rows={2} maxLength={1000} value={draft} placeholder="Ask about USTX…" onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(draft); } }} />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send"><Icon name="send" size={18} /></button>
      </form>
      <p className="gmd-ask-note">Demo dollars and USTX have no value. Answers are not investment advice and can be wrong; check figures on <Link prefetch={false} href="/products/ustx/transparency">Transparency</Link>.</p>
    </section>}
  </AskContext.Provider>;
}

type Screen = "markets" | "product" | "pools" | "portfolio" | "verify" | "fund" | "other";

function screenOf(path: string): Screen {
  if (path === "/") return "markets";
  if (path === "/pools") return "pools";
  if (path === "/portfolio") return "portfolio";
  if (path === "/products/ustx/transparency") return "verify";
  if (path === "/products/ustx") return "product";
  if (path.startsWith("/funds/")) return "fund";
  return "other";
}

/** For each screen: the questions the guide offers, and the one step it points to. */
const GUIDE: Record<Screen, { questions: string[]; action?: { label: string; href: string } }> = {
  markets: {
    questions: ["Which holdings move USTX's NAV the most?", "What does one USTX share hold?", "Where would $500 buy the most USTX right now?"],
    action: { label: "Try a $100 demo buy", href: "/products/ustx" },
  },
  product: {
    questions: ["Where would $500 buy the most USTX right now?", "Is the latest NAV verified?", "How much could I borrow against 10 USTX?"],
    action: { label: "Earn fees in a pool", href: "/pools" },
  },
  pools: {
    questions: ["How does a pool earn fees for me?", "What happens to a $1,000 deposit if the NAV moves 10%?", "How have the two pools done for providers?"],
    action: { label: "Add liquidity in one step", href: "/pools#provide" },
  },
  portfolio: {
    questions: ["What is inside one USTX share?", "How is my USTX valued?", "How do I get demo dollars for my wallet?"],
    action: { label: "Buy USTX with demo dollars", href: "/products/ustx" },
  },
  verify: {
    questions: ["How does my browser check the NAV?", "Is the latest NAV verified?", "What would a tampered record look like?"],
    action: { label: "See the developer checks", href: "/developers" },
  },
  fund: {
    questions: ["How are these funds priced?", "How is each NAV recorded on X Layer?", "What does USTX hold?"],
    action: { label: "Compare all funds", href: "/" },
  },
  other: {
    questions: ["What is USTX?", "What is USTX's NAV right now?", "How is the NAV checked?"],
    action: { label: "Go to Markets", href: "/" },
  },
};

type Facts = { navUsd: number | null; recordedAt: string | null; premium: number | null; v4Premium: number | null; aprPercent: string | null; poolValue: number | null; v4Value: number | null };

/** The latest NAV record and both pools, from the public API: every minute while the page is visible. */
function useFacts(): Facts | null {
  const [facts, setFacts] = useState<Facts | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nav, pools] = await Promise.all([
          fetch("/api/v1/ustx").then(response => response.ok ? response.json() : null).catch(() => null),
          fetch("/api/v1/ustx/pools").then(response => response.ok ? response.json() : null).catch(() => null),
        ]) as [{ nav?: { perShareUsd?: string; recordedAt?: string } } | null, { pools?: { id: string; priceMicros?: string; navMicros?: string; valueMicros?: string; feeApr?: { percent?: string } | null }[] } | null];
        const premium = (id: string) => {
          const pool = pools?.pools?.find(item => item.id === id);
          return pool?.priceMicros && pool.navMicros && Number(pool.navMicros) > 0 ? (Number(pool.priceMicros) - Number(pool.navMicros)) / Number(pool.navMicros) : null;
        };
        const value = (id: string) => { const micros = pools?.pools?.find(item => item.id === id)?.valueMicros; return micros ? Number(micros) / 1e6 : null; };
        if (!cancelled) setFacts({
          navUsd: nav?.nav?.perShareUsd ? Number(nav.nav.perShareUsd) : null,
          recordedAt: nav?.nav?.recordedAt ?? null,
          premium: premium("ustx-dusd"), v4Premium: premium("ustx-dusd-v4"),
          aprPercent: pools?.pools?.find(item => item.id === "ustx-dusd")?.feeApr?.percent ?? null,
          poolValue: value("ustx-dusd"), v4Value: value("ustx-dusd-v4"),
        });
      } catch { /* The guide then shows its questions without figures. */ }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return facts;
}

const dollars = (value: number, digits = 2) => `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const signed = (ratio: number) => Math.abs(ratio) < 0.00005 ? "0.00%" : `${ratio > 0 ? "+" : "−"}${Math.abs(ratio * 100).toFixed(2)}%`;
function ago(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return minutes === 0 ? "just now" : minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

/** What is happening now, in one line of figures for the screen. */
function insight(screen: Screen, facts: Facts | null, now: number): string {
  const nav = facts?.navUsd != null ? `USTX NAV ${dollars(facts.navUsd, 4)}${facts.recordedAt ? `, recorded ${ago(facts.recordedAt, now)} on X Layer` : ""}.` : null;
  const pools = facts && (facts.premium !== null || facts.v4Premium !== null)
    ? `Against the NAV: ${[facts.premium !== null ? `classic pool ${signed(facts.premium)}` : null, facts.v4Premium !== null ? `v4 pool ${signed(facts.v4Premium)}` : null].filter(Boolean).join(", ")}.` : null;
  switch (screen) {
    case "pools": return [
      facts?.aprPercent ? `The classic pool's fee APR is ${facts.aprPercent}% over 7 days${facts.poolValue !== null ? `, on ${dollars(facts.poolValue, 0)} in the pool` : ""}.` : null,
      facts?.v4Value != null ? `The v4 pool holds ${dollars(facts.v4Value, 0)} and is held at the NAV.` : null,
      "Add liquidity from demo dollars alone, in one step.",
    ].filter(Boolean).join(" ");
    case "portfolio": return "Your demo balance starts with $10,000 of demo dollars in this browser. Connect OKX Wallet to see the USTX and dUSD in your wallet as well.";
    case "verify": return [nav, "Every check below runs again in your browser, against X Layer."].filter(Boolean).join(" ");
    case "fund": return [nav, "These funds are bought with your demo balance; each NAV is recorded on X Layer every five minutes."].filter(Boolean).join(" ");
    default: return [nav, pools].filter(Boolean).join(" ") || "Ask about USTX's NAV, what a share holds and where an order fills best.";
  }
}

/** The AI guide at the top of a product screen: the figures now, three questions to ask, and a next step. */
export function AskGuide() {
  const context = useContext(AskContext);
  const path = usePathname() ?? "/";
  const screen = screenOf(path);
  const facts = useFacts();
  const [now, setNow] = useState(0);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  if (!context) return null;
  const guide = GUIDE[screen];
  return <section className="gmd-ask-guide" aria-labelledby="gmd-ask-guide-title">
    <div className="gmd-ask-guide-head">
      <span className="gmd-ask-guide-mark" aria-hidden="true"><Icon name="spark" size={18} /></span>
      <div><h2 id="gmd-ask-guide-title">Ask USTX <small>AI</small></h2><p aria-live="polite">{now ? insight(screen, facts, now) : "Reading the latest record…"}</p></div>
    </div>
    <div className="gmd-ask-guide-actions">
      {guide.questions.map(question => <button type="button" key={question} onClick={() => context.ask(question)}>{question}</button>)}
      {guide.action && <Link prefetch={false} className="gmd-ask-guide-step" href={guide.action.href}>{guide.action.label}<Icon name="arrow" size={15} /></Link>}
    </div>
    <form className="gmd-ask-guide-form" onSubmit={event => { event.preventDefault(); if (draft.trim()) { context.ask(draft); setDraft(""); } }}>
      <label className="gmd-sr-only" htmlFor="gmd-ask-guide-input">Ask anything about USTX</label>
      <input id="gmd-ask-guide-input" value={draft} maxLength={1000} autoComplete="off" placeholder="Ask anything about USTX…" onChange={event => setDraft(event.target.value)} />
      <button type="submit" disabled={!draft.trim()} aria-label="Ask"><Icon name="send" size={17} /></button>
    </form>
  </section>;
}
