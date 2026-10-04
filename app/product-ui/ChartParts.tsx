"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icons";
import { useAsk } from "./AskUstx";

// Shared pieces of the charts on Pools and the income pages: a plot that draws at its real width,
// and a heading whose button asks Ask USTX to explain the chart with the figures on screen.

/**
 * The plot's width in CSS pixels, so the chart draws at its real size and its text stays 12px on a
 * phone too. A callback ref, so a plot that appears after the first render (once data arrives) is
 * measured as well.
 */
export function useWidth(initial: number) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width] as const;
}

/** A chart's heading, with the button that asks Ask USTX to explain it with the figures on screen. */
export function ChartHead({ id, title, question, children }: { id: string; title: string; question: string; children?: ReactNode }) {
  const assistant = useAsk();
  return <div className="gmd-lq-head">
    <h3 id={id}>{title}</h3>
    {children}
    {assistant && <button type="button" className="gmd-lq-explain" onClick={() => assistant.ask(question)}><Icon name="spark" size={14} />Explain with AI</button>}
  </div>;
}
