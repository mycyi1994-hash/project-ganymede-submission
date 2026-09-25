import { headers } from "next/headers";
import { BasketBadge } from "../../product-ui/BasketCheck";
import { basketConfigPath } from "@/lib/xstocks/basket-config";
import "../../product-ui/product.css";

export const metadata = { title: "Verified basket NAV · Ganymede", robots: { index: false } };

// The badge for any basket configured on this site. Only a configuration under /baskets/ is loaded.
export default async function EmbedBasketPage({ searchParams }: { searchParams: Promise<{ config?: string | string[] }> }) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "ganymede-xlayer.gana003.workers.dev";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const { config } = await searchParams;
  return <main className="gmd-app gmd-embed"><BasketBadge path={basketConfigPath(typeof config === "string" ? config : null)} site={`${protocol}://${host}`} /></main>;
}
