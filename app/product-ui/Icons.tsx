import type { CSSProperties } from "react";

export function Icon({ name, size = 20 }: { name: "arrow" | "back" | "external" | "wallet" | "market" | "portfolio" | "activity" | "check" | "info" | "refresh" | "chevron" | "lock" | "download"; size?: number }) {
  const paths: Record<string, string> = {
    arrow: "M5 12h14m-5-5 5 5-5 5", back: "M19 12H5m5-5-5 5 5 5", external: "M8 5h11v11M19 5 5 19",
    wallet: "M4 7V5a2 2 0 0 1 2-2h12v4M4 7h16v14H4V7Zm12 5h4v5h-4a2.5 2.5 0 0 1 0-5Z",
    market: "M4 20V10h4v10m4 0V4h4v16m4 0V8M2 20h20",
    portfolio: "M12 3v9h9M9 3.6a9 9 0 1 0 11.4 11.4M15 3.6A9 9 0 0 1 20.4 9H15V3.6Z",
    activity: "M4 5h16M4 12h10M4 19h16m-1-10 3 3-3 3",
    check: "m5 12 4 4L19 6", info: "M12 11v6m0-10v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    refresh: "M20 7v5h-5M4 17v-5h5m10-4a7 7 0 0 0-12-3L4 8m1 8a7 7 0 0 0 12 3l3-3",
    chevron: "m9 5 7 7-7 7", lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 5v2",
    download: "M12 4v11m-5-5 5 5 5-5M5 20h14",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export const assetColors: Record<string, string> = { AAPLx: "#253F49", MSFTx: "#476974", NVDAx: "#2B837B", AMZNx: "#80AAA6", METAx: "#94AAB8", TSLAx: "#C3D2D8" };
export function assetStyle(symbol: string): CSSProperties { return { "--asset-color": assetColors[symbol] ?? "#526570" } as CSSProperties; }
export const assetNames: Record<string, string> = { AAPLx: "Apple", MSFTx: "Microsoft", NVDAx: "NVIDIA", AMZNx: "Amazon", METAx: "Meta", TSLAx: "Tesla" };
export const assetSymbols = Object.keys(assetNames);

export function AssetMark({ symbol }: { symbol: string }) {
  const brand = ({ AAPLx: "apple", MSFTx: "microsoft", NVDAx: "nvidia", AMZNx: "amazon", METAx: "meta", TSLAx: "tesla" } as Record<string, string>)[symbol];
  return <span className="gmd-asset-mark" aria-hidden="true">{brand === "microsoft" ? <span className="gmd-ms"><i /><i /><i /><i /></span> : brand ? <img src={`/brands/${brand}.svg`} alt="" width="24" height="24" /> : symbol.slice(0, 1)}</span>;
}
