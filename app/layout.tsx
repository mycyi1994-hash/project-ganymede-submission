import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "ganymede-xlayer.gana003.workers.dev";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const imageUrl = `${protocol}://${host}/images/clearform-stack.webp`;
  const title = "Ganymede — US Tech Basket";
  const description = "Invest in nine US tech leaders in one share. The US Tech Basket tracks Apple, Microsoft, NVIDIA, Amazon, Meta, Tesla, Alphabet, Oracle and Palantir xStocks on X Layer, priced by OKX OnchainOS and recorded on X Layer so you can verify every NAV. Demo dollars on X Layer Testnet.";

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

// After a release, a tab opened before it still asks for the files of its own build, which the new
// deploy no longer serves, so a page it moves to (Pools, say) never draws. Vite raises
// vite:preloadError then, often before the address changes: the page the visitor was going to (the
// link last pressed) loads from the server, which hands it the new build. Once per address a
// minute, and never within a minute of a fresh load when storage is off, so a file missing for good
// cannot keep reloading the page.
const RELOAD_ON_STALE_BUILD = `(function(){var target=null;addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(a&&a.origin===location.origin)target={href:a.href,at:Date.now()}},true);addEventListener("vite:preloadError",function(event){var now=Date.now(),href=target&&now-target.at<15e3?target.href:location.href,key="gmd-stale-build",seen=null;try{seen=JSON.parse(sessionStorage.getItem(key)||"null")}catch(e){}if(seen&&seen.href===href&&now-seen.at<6e4)return;try{sessionStorage.setItem(key,JSON.stringify({href:href,at:now}))}catch(e){if(now-performance.timeOrigin<6e4)return}event.preventDefault();location.assign(href)})})();`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The page's script nonce, set by the Worker for every request (worker/index.ts).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en">
      <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: RELOAD_ON_STALE_BUILD }} /></head>
      <body>{children}</body>
    </html>
  );
}
