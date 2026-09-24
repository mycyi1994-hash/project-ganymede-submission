import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "ganymede-xlayer.gana003.workers.dev";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const imageUrl = `${protocol}://${host}/images/clearform-stack.webp`;
  const title = "Ganymede — US Tech Basket";
  const description = "Explore the US Tech Basket: six xStocks, a defined allocation and transparent NAV records on X Layer Testnet. Subscriptions are not open.";

  return {
    title,
    description,
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title,
      description,
      images: [{ url: imageUrl, width: 1254, height: 1254, alt: "Six transparent layers representing the Ganymede US tech model basket" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
