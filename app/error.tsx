"use client";

/* A fresh document navigation also clears an errored client tree. */
/* eslint-disable @next/next/no-html-link-for-pages */

import SiteHeader from "./SiteHeader";
import { SiteFooter } from "./DesignElements";

export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return <><SiteHeader current={null} /><main className="not-found-page"><span className="eyebrow">Page unavailable</span><h1>Let’s try that again.</h1><p>This page couldn’t be loaded. You can retry or explore the fund collection.</p><div className="button-row"><button className="is-primary" onClick={reset}>Try again</button><a className="button" href="/?app=select">Explore funds</a></div></main><SiteFooter /></>;
}
