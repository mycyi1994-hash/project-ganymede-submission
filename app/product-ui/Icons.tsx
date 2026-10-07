import type { CSSProperties } from "react";
// The product stylesheet rides on this module, which every product screen and badge imports:
// a stylesheet imported on its own becomes an empty chunk that the build drops but still preloads.
import "./product.css";
// The workspace's look, after the product stylesheet it restyles: a sidebar and a white panel on a grey canvas.
import "./platform.css";

export type IconName = "arrow" | "back" | "external" | "wallet" | "market" | "portfolio" | "activity" | "check" | "info" | "refresh" | "chevron" | "lock" | "download" | "close" | "pool" | "spark" | "send" | "undo" | "redo" | "book" | "shield" | "code" | "building" | "coins";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<string, string> = {
    arrow: "M5 12h14m-5-5 5 5-5 5", back: "M19 12H5m5-5-5 5 5 5", external: "M8 5h11v11M19 5 5 19",
    wallet: "M4 7V5a2 2 0 0 1 2-2h12v4M4 7h16v14H4V7Zm12 5h4v5h-4a2.5 2.5 0 0 1 0-5Z",
    market: "M4 20V10h4v10m4 0V4h4v16m4 0V8M2 20h20",
    portfolio: "M12 3v9h9M9 3.6a9 9 0 1 0 11.4 11.4M15 3.6A9 9 0 0 1 20.4 9H15V3.6Z",
    activity: "M4 5h16M4 12h10M4 19h16m-1-10 3 3-3 3",
    check: "m5 12 4 4L19 6", info: "M12 11v6m0-10v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    refresh: "M20 7v5h-5M4 17v-5h5m10-4a7 7 0 0 0-12-3L4 8m1 8a7 7 0 0 0 12 3l3-3",
    chevron: "m9 5 7 7-7 7", lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 5v2",
    download: "M12 4v11m-5-5 5 5 5-5M5 20h14", close: "M6 6l12 12M18 6 6 18",
    spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z",
    send: "M4 12 20 4l-6 16-3-7-7-1Z",
    undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11", redo: "m15 14 5-5-5-5m5 5H9.5a5.5 5.5 0 0 0 0 11H13",
    pool: "M3 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 3 2 3 2M3 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 3 2 3 2M12 3c2.5 3 4 5 4 6.5a4 4 0 0 1-8 0C8 8 9.5 6 12 3Z",
    book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Zm0 15A1.5 1.5 0 0 0 6.5 21H19",
    shield: "M12 3 19 6v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6l7-3Z",
    code: "m8 8-4 4 4 4m8-8 4 4-4 4M13.5 5l-3 14",
    building: "M4 21V5.5L12 3v18M12 8h7v13M7.5 8h1M7.5 12h1M7.5 16h1M15 12h1M15 16h1M2 21h20",
    coins: "M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Zm4.1 2.4A6 6 0 1 1 10.4 18.1M7 6h1v4m8.7 3.9.7.7-2.8 2.8",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

// One hue per xStock, in basket order. Checked as a ring (the last segment meets the first) with the
// dataviz palette validator on white: adjacent colour-blind separation ΔE 8.4, normal vision 15.8.
// Nine is past the eight-hue palette, so PLTRx's plum was chosen to pass every check beside its
// neighbours, and AMZNx sits under 3:1 against white: every chart that uses them names each asset in text.
export const assetColors: Record<string, string> = { AAPLx: "#296dc0", MSFTx: "#d66235", NVDAx: "#25a071", AMZNx: "#da971f", METAx: "#d47498", TSLAx: "#097508", GOOGLx: "#4a3aa7", ORCLx: "#e34948", PLTRx: "#8f4f8f",
  // Additional baskets reuse these hues, with the same asset colour in every fund.
  AMDx: "#da971f", INTCx: "#296dc0", COINx: "#296dc0", MSTRx: "#d66235", CRCLx: "#25a071", HOODx: "#4a3aa7", GMEx: "#e34948", SPYx: "#296dc0", QQQx: "#25a071",
};
export function assetStyle(symbol: string): CSSProperties { return { "--asset-color": assetColors[symbol] ?? "#526570" } as CSSProperties; }
export const assetNames: Record<string, string> = { AAPLx: "Apple", MSFTx: "Microsoft", NVDAx: "NVIDIA", AMZNx: "Amazon", METAx: "Meta", TSLAx: "Tesla", GOOGLx: "Alphabet", ORCLx: "Oracle", PLTRx: "Palantir" };
export const assetSymbols = Object.keys(assetNames);

export function AssetMark({ symbol }: { symbol: string }) {
  const brand = ({ AAPLx: "apple", MSFTx: "microsoft", NVDAx: "nvidia", AMZNx: "amazon", METAx: "meta", TSLAx: "tesla", GOOGLx: "google", ORCLx: "oracle", PLTRx: "palantir", AMDx: "amd", INTCx: "intel", COINx: "coinbase", MSTRx: "microstrategy", CRCLx: "circle", HOODx: "robinhood" } as Record<string, string>)[symbol];
  return <span className="gmd-asset-mark" aria-hidden="true">{brand === "microsoft" ? <span className="gmd-ms"><i /><i /><i /><i /></span> : brand ? <img src={`/brands/${brand}.svg`} alt="" width="24" height="24" /> : symbol.slice(0, 1)}</span>;
}

/** A placeholder bar while the first read is on its way; never shown over data already on the page. */
export function Skeleton({ width, className = "" }: { width?: number | string; className?: string }) {
  return <i className={`gmd-skeleton${className ? ` ${className}` : ""}`} style={width === undefined ? undefined : { width }} aria-hidden="true" />;
}
