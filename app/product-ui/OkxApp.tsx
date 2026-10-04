"use client";

import { okxAppUrl } from "@/lib/okx-app";
import { Icon } from "./Icons";

/** "Open in the OKX app" for this page: the link takes the page's own address when it is followed. */
export function OkxAppLink({ className = "gmd-button is-secondary" }: { className?: string }) {
  return <a className={className} href={okxAppUrl("https://ganymede-xlayer.gana003.workers.dev/products/ustx")} rel="noreferrer" onClick={event => { event.currentTarget.href = okxAppUrl(window.location.href); }}>Open in the OKX app <Icon name="external" size={16} /></a>;
}
