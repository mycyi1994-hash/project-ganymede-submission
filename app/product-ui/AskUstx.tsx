"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

// Ask USTX: a question box over the product screens. Answers come from POST /api/assistant, which
// reads X Layer through the same read-only tools as the MCP server; each answer names the tools it read.

type Turn = { role: "user" | "assistant"; content: string; tools?: string[] };

const SUGGESTIONS = [
  "What is USTX's NAV right now?",
  "Is the latest NAV verified?",
  "What does one USTX share hold?",
  "Where would $500 buy the most USTX?",
  "How have the two pools done for liquidity providers?",
];

const TOOL_LABELS: Record<string, string> = {
  get_ustx_nav: "NAV registry",
  verify_ustx_nav: "record check",
  get_ustx_holdings: "holdings",
  quote_ustx_order: "fund and pool quotes",
  get_ustx_pools: "pools",
  get_ustx_market_activity: "market activity",
};

export function AskUstx() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [turns, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setDraft("");
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-12).map(({ role, content }) => ({ role, content })) }),
      });
      const body = await response.json().catch(() => ({})) as { answer?: string; toolsUsed?: string[]; error?: string };
      if (!response.ok || !body.answer) throw new Error(body.error || "The assistant is unavailable right now.");
      setTurns([...next, { role: "assistant", content: body.answer, tools: body.toolsUsed ?? [] }]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The assistant is unavailable right now.");
      setTurns(turns);
      setDraft(text);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" className="gmd-ask-launch" onClick={() => setOpen(true)} aria-haspopup="dialog"><Icon name="spark" size={18} />Ask USTX</button>;

  return <section className="gmd-ask" role="dialog" aria-label="Ask USTX" onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
    <header><div><strong><Icon name="spark" size={17} />Ask USTX</strong><span>Answers read live from X Layer Testnet</span></div>
      <div>{turns.length > 0 && <button type="button" className="gmd-ask-reset" onClick={() => { setTurns([]); setError(null); }}>New chat</button>}<button type="button" aria-label="Close Ask USTX" onClick={() => setOpen(false)}><Icon name="close" size={18} /></button></div>
    </header>
    <div className="gmd-ask-log" ref={log} aria-live="polite">
      {turns.length === 0 && <div className="gmd-ask-intro"><p>Ask about USTX&rsquo;s NAV, what a share holds, quotes at the fund and the pools, or how the record is checked.</p>
        <ul>{SUGGESTIONS.map(suggestion => <li key={suggestion}><button type="button" onClick={() => void ask(suggestion)}>{suggestion}</button></li>)}</ul></div>}
      {turns.map((turn, index) => <div key={index} className={`gmd-ask-turn is-${turn.role}`}>
        <p>{turn.content}</p>
        {turn.role === "assistant" && turn.tools && turn.tools.length > 0 && <small><Icon name="check" size={13} />Read from {turn.tools.map(tool => TOOL_LABELS[tool] ?? tool).join(", ")}</small>}
      </div>)}
      {busy && <div className="gmd-ask-turn is-assistant is-busy"><p>Reading X Layer…</p></div>}
      {error && <p className="gmd-ask-error" role="alert">{error}</p>}
    </div>
    <form onSubmit={event => { event.preventDefault(); void ask(draft); }}>
      <label className="gmd-sr-only" htmlFor="gmd-ask-input">Your question</label>
      <textarea id="gmd-ask-input" ref={input} rows={2} maxLength={1000} value={draft} placeholder="Ask about USTX…" onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(draft); } }} />
      <button type="submit" disabled={busy || !draft.trim()} aria-label="Send"><Icon name="send" size={18} /></button>
    </form>
    <p className="gmd-ask-note">Demo dollars and USTX have no value. Answers are not investment advice and can be wrong; check figures on <Link prefetch={false} href="/products/ustx/transparency">Transparency</Link>.</p>
  </section>;
}
