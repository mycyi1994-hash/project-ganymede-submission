import type { ReactNode } from "react";

/** Marks figures that come from OKX: prices from OKX OnchainOS, records on X Layer. Text only, no OKX logo. */
export function OkxSource({ children = "Prices by OKX OnchainOS" }: { children?: ReactNode }) {
  return <span className="gmd-okx-source"><span className="gmd-okx-dot" aria-hidden="true" />{children}</span>;
}
