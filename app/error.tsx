"use client";

/* A fresh document navigation also clears an errored client tree. */
/* eslint-disable @next/next/no-html-link-for-pages */

import { ProductShell } from "./product-ui/ProductShell";

export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return <ProductShell><section className="gmd-unavailable-page"><span className="gmd-badge">Page unavailable</span><h1>Let’s try that again.</h1><p>This page couldn’t be loaded. Retry the page or return to markets.</p><div><button className="gmd-button" onClick={reset}>Try again</button><a className="gmd-button is-secondary" href="/">Back to markets</a></div></section></ProductShell>;
}
