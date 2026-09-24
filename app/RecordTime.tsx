"use client";

import { useEffect, useState } from "react";
import { elapsedTime, formatRecordTime } from "@/lib/nav-status";

export default function RecordTime({ value }: { value?: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, []);
  return <time className="record-time" dateTime={value ?? undefined}>{formatRecordTime(value)}{value && now !== null && <small>{elapsedTime(value, now)}</small>}</time>;
}
