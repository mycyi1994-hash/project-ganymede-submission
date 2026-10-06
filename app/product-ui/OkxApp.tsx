"use client";

import { useEffect, useRef } from "react";
import { okxAppUrl } from "@/lib/okx-app";
import { Icon } from "./Icons";

/** "Open in the OKX app" for this page: the link carries the page's own address once the page is open. */
export function OkxAppLink({ className = "gmd-button is-secondary" }: { className?: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => { if (link.current) link.current.href = okxAppUrl(window.location.href); }, []);
  return <a ref={link} className={className} href={okxAppUrl("https://ganymede-xlayer.gana003.workers.dev/products/ustx")} rel="noreferrer" onClick={event => { event.currentTarget.href = okxAppUrl(window.location.href); }}>Open in the OKX app <Icon name="external" size={16} /></a>;
}
