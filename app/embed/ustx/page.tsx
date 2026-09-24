import { headers } from "next/headers";
import EmbedBadge from "../../product-ui/EmbedBadge";

export const metadata = { title: "USTX verified NAV · Ganymede", robots: { index: false } };

export default async function EmbedPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "ganymede-xlayer.gana003.workers.dev";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  return <EmbedBadge site={`${protocol}://${host}`} />;
}
