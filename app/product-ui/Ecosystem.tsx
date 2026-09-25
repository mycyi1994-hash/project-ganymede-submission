import Link from "next/link";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { XSTOCKS_PRODUCT_KEY } from "@/lib/xstocks/onchain";
import { ProductShell } from "./ProductShell";
import { DocumentMenu } from "./DocumentMenu";
import { Icon } from "./Icons";
import VerifyYourself from "./VerifyYourself";

const SITE = "https://ganymede-xlayer.gana003.workers.dev";
const REPOSITORY = "https://github.com/mycyi1994-hash/project-ganymede-submission";

const apiExample = `{
  "product": { "id": "us-tech-x", "ticker": "USTX", "name": "US Tech Basket", … },
  "nav": {
    "perShareUsd": "99.449929",
    "perShareMicros": "99449929",
    "sharesOutstandingMicros": "1520833514",
    "effectiveAt": "2026-09-24T18:05:17.000Z",
    "holdingsHash": "0x3858…96fb"
  },
  "record": { "network": "X Layer Testnet", "chainId": 1952, "registry": "${PROOF_DEPLOYMENT.registry}", "transactionHash": "0x…", … },
  "pricing": { "source": "OKX OnchainOS", "chain": "X Layer", "chainIndex": "196", "interval": "5 minutes" },
  "verify": { "page": "${SITE}/products/ustx/transparency", … }
}`;

const viemExample = `import { createPublicClient, http, parseAbi } from "viem";

const client = createPublicClient({ transport: http("${PROOF_DEPLOYMENT.rpcUrl}") });
const [navPerShareMicros, sharesOutstandingMicros, holdingsHash, effectiveAt] = await client.readContract({
  address: "${PROOF_DEPLOYMENT.registry}",
  abi: parseAbi(["function latestNav(bytes32) view returns (uint256, uint256, bytes32, uint64, uint64)"]),
  functionName: "latestNav",
  args: ["${XSTOCKS_PRODUCT_KEY}"], // keccak256("us-tech-x")
});`;

const embedExample = `<iframe src="${SITE}/embed/ustx" title="USTX verified NAV"
  width="440" height="260" style="border:0" loading="lazy"></iframe>`;

function Code({ label, children }: { label: string; children: string }) {
  // Wide code scrolls sideways, so keyboard users can focus it to scroll.
  return <figure className="gmd-code"><figcaption>{label}</figcaption><pre tabIndex={0} role="region" aria-label={`${label} code`}><code>{children}</code></pre></figure>;
}

export function DevelopersPage() {
  return <ProductShell><Link className="gmd-breadcrumb" prefetch={false} href="/"><Icon name="back" size={16} />Markets</Link>
    <div className="gmd-document-layout"><DocumentMenu current="developers" />
      <article className="gmd-document"><header><h1>Build with a NAV anyone can verify.</h1><p>Every USTX NAV is priced with OKX OnchainOS and recorded on X Layer with a fingerprint of its composition. Read it from our API, read it straight from the chain, or embed a badge that checks it in your visitor’s browser.</p></header>
        <section id="api"><h2>Public NAV API</h2><p>The latest USTX record, read from the registry on X Layer when you call it. No key, no cookies, CORS open to every origin, cacheable for 30 seconds.</p>
          <Code label="Request">{`curl ${SITE}/api/v1/ustx`}</Code>
          <Code label="Response (abridged)">{apiExample}</Code>
          <p>Also available: <code>GET /api/xstocks</code> returns the full market snapshot with the composition documents behind recent records, and <code>GET /api/demo/fund</code> returns fund totals and 24-hour flows.</p>
          <a className="gmd-inline-link" href="/api/v1/ustx" target="_blank" rel="noreferrer">Open the live response <Icon name="external" size={14} /></a>
        </section>
        <section id="chain"><h2>Read the record from X Layer yourself</h2><p>You do not have to trust our API. The registry is a public contract on X Layer Testnet (chain {PROOF_DEPLOYMENT.chainId}); its <code>latestNav</code> getter returns the NAV per share, the shares outstanding, the composition fingerprint and the effective time.</p>
          <Code label="TypeScript with viem">{viemExample}</Code>
          <a className="gmd-inline-link" href={`${PROOF_DEPLOYMENT.explorerUrl}/address/${PROOF_DEPLOYMENT.registry}`} target="_blank" rel="noreferrer">View the registry on the OKX explorer <Icon name="external" size={14} /></a>
        </section>
        <section id="embed"><h2>Embed the verified NAV badge</h2><p>Show the USTX NAV on your site, wallet or dashboard. The badge reads X Layer from the visitor’s browser, hashes the published document and recalculates the NAV before it says “Verified”.</p>
          <Code label="HTML">{embedExample}</Code>
          <div className="gmd-embed-preview"><span>Live preview</span><iframe src="/embed/ustx" title="USTX verified NAV badge preview" width="440" height="260" loading="lazy" /></div>
        </section>
        <section id="verify"><h2>Verify it yourself</h2><p>The Transparency page shows customers the result. Here are the checks behind it, live in your browser: the registry read from X Layer, the SHA-256 fingerprint of the original composition document and the NAV recalculated row by row. Break a copy to see which check catches which edit, then download the evidence file and re-check it anywhere.</p>
          <VerifyYourself />
          <Code label="Re-check a downloaded file">{`git clone ${REPOSITORY}\ncd project-ganymede-submission && npm install\nnpm run verify:evidence -- ustx-evidence.json`}</Code>
        </section>
        <section id="okx"><h2>Built on the OKX stack</h2>
          <ul className="gmd-stack-list">
            <li><b>OKX OnchainOS Market API</b><span>Prices all six xStocks on X Layer every five minutes. The NAV is never published without them.</span></li>
            <li><b>X Layer Testnet</b><span>Holds the NAV registry: every NAV, its composition fingerprint and the shares outstanding.</span></li>
            <li><b>X Layer mainnet</b><span>Where the xStocks live. Portfolio reads any wallet’s xStock balances directly from mainnet.</span></li>
            <li><b>OKX Wallet</b><span>Connects first on Portfolio, read-only: it shares an address and never signs.</span></li>
            <li><b>OKX explorer</b><span>Every record, token and transaction links to the OKX X Layer explorer.</span></li>
          </ul>
        </section>
        <footer><p>Source, tests and deployment notes are public. Records are on X Layer Testnet and investing uses demo dollars.</p><div className="gmd-terms-links"><a className="gmd-button" href={REPOSITORY} target="_blank" rel="noreferrer">View the source <Icon name="external" size={16} /></a><Link prefetch={false} className="gmd-inline-link" href="/issuers">Launch a basket <Icon name="arrow" size={16} /></Link></div></footer>
      </article></div></ProductShell>;
}

const steps = [
  ["Define the basket", "Choose the tokenized stocks on X Layer, their weights and the rebalancing schedule. Units per share are fixed at launch."],
  ["Price it with OKX OnchainOS", "Ganymede prices every constituent every five minutes and refuses to publish when a price is missing or stale."],
  ["Record it on X Layer", "Each NAV, the shares outstanding and a SHA-256 fingerprint of the full composition are written to the registry."],
  ["Sell it, and let investors check", "Investors buy and redeem in the Ganymede app and verify every price in their own browser. Partners embed the badge or read the API."],
] as const;

const plans = [
  { name: "Sandbox", price: "Free", note: "Available now", items: ["Testnet NAV records", "Demo investing app", "Public API and badge"] },
  { name: "Issuer", price: "$990", unit: "per basket / month", note: "Planned", items: ["X Layer mainnet records", "Your own basket and branding", "Full evidence archive"] },
  { name: "Distribution", price: "0.10%", unit: "a year on assets raised", note: "Planned, where licensed", items: ["Listing in the Ganymede app", "Partner wallets and sites", "Investor reporting"] },
] as const;

const roadmap = [
  ["Now", "USTX priced by OKX OnchainOS and recorded on X Layer every five minutes; demo investing, look-through portfolio, public API and embeddable badge."],
  ["Q4 2026", "Registry on X Layer mainnet, a second basket and an archive that keeps every composition document."],
  ["Q1 2027", "Issuer console to define and launch baskets, and an on-chain share token for allow-listed investors (the contract is already written and tested)."],
  ["Q2 2027", "Distribution with licensed partners: real subscriptions and redemptions where regulation allows."],
] as const;

export function IssuersPage() {
  return <ProductShell><Link className="gmd-breadcrumb" prefetch={false} href="/"><Icon name="back" size={16} />Markets</Link>
    <div className="gmd-document-layout"><DocumentMenu current="issuers" />
      <article className="gmd-document"><header><h1>Launch a basket investors can verify.</h1><p>Ganymede turns tokenized stocks on X Layer into a fund product with a NAV anyone can check: priced by OKX OnchainOS, recorded on X Layer every five minutes and verified in the investor’s own browser.</p></header>
        <section id="why"><h2>Why it matters</h2><p>Tokenized stocks such as xStocks already trade on X Layer, but a basket built from them usually asks investors to trust the issuer’s price. Ganymede publishes the evidence with every price, so a wallet, an exchange or an investor can confirm the NAV without asking anyone. That makes a basket easier to list, easier to distribute and harder to misprice.</p></section>
        <section id="how"><h2>How it works</h2><ol className="gmd-steps">{steps.map(([title, copy], index) => <li key={title}><span>{index + 1}</span><div><b>{title}</b><p>{copy}</p></div></li>)}</ol></section>
        <section id="get"><h2>What you get</h2><ul className="gmd-stack-list">
          <li><b>An investor app</b><span>Markets, a product page with fund figures, invest and redeem, and a portfolio that looks through to every token.</span></li>
          <li><b>Verification built in</b><span>A transparency page with a tamper experiment, evidence files and an open-source verifier.</span></li>
          <li><b>Distribution tools</b><span>A public NAV API and a badge any partner can embed, both backed by the record on X Layer.</span></li>
          <li><b>Operations</b><span>Scheduled pricing, publication with idempotent retries, and rate-limit handling for the price provider.</span></li>
        </ul><Link prefetch={false} className="gmd-inline-link" href="/products/ustx">See it working with USTX <Icon name="arrow" size={16} /></Link></section>
        <section id="pricing"><h2>Pricing</h2><div className="gmd-plans">{plans.map(plan => <article key={plan.name}><span>{plan.note}</span><h3>{plan.name}</h3><strong>{plan.price}{"unit" in plan && <small> {plan.unit}</small>}</strong><ul>{plan.items.map(item => <li key={item}><Icon name="check" size={15} />{item}</li>)}</ul></article>)}</div><p className="gmd-caption">Planned pricing for discussion. Real-money services start only with licensed partners in the markets they serve.</p></section>
        <section id="roadmap"><h2>Roadmap</h2><ol className="gmd-roadmap">{roadmap.map(([when, copy]) => <li key={when}><b>{when}</b><p>{copy}</p></li>)}</ol></section>
        <footer><p>Want to launch a basket, list USTX or integrate the NAV? Open an issue on GitHub and we will follow up.</p><div className="gmd-terms-links"><a className="gmd-button" href={`${REPOSITORY}/issues`} target="_blank" rel="noreferrer">Contact us on GitHub <Icon name="external" size={16} /></a><Link prefetch={false} className="gmd-inline-link" href="/developers">Developer docs <Icon name="arrow" size={16} /></Link></div></footer>
      </article></div></ProductShell>;
}
