import Link from "next/link";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { XSTOCKS_PRODUCT_KEY } from "@/lib/xstocks/onchain";
import { FUND_DEPLOYMENT } from "@/lib/xstocks/fund";
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

const investExample = `import { parseAbi } from "viem";

const fund = "${FUND_DEPLOYMENT.fund}";   // USTX shares, X Layer Testnet
const dollar = "${FUND_DEPLOYMENT.dollar}"; // dUSD demo dollars, no value
const abi = parseAbi([
  "function claim()",
  "function approve(address spender, uint256 value) returns (bool)",
  "function previewInvest(uint256 dollars) view returns (uint256)",
  "function invest(uint256 dollars, uint256 minShares) returns (uint256)",
  "function redeem(uint256 shares, uint256 minDollars) returns (uint256)",
]);

const amount = 1_000_000_000n; // $1,000 in micros
await wallet.writeContract({ address: dollar, abi, functionName: "claim" }); // 10,000 dUSD, once a day
await wallet.writeContract({ address: dollar, abi, functionName: "approve", args: [fund, amount] });
const shares = await client.readContract({ address: fund, abi, functionName: "previewInvest", args: [amount] });
await wallet.writeContract({ address: fund, abi, functionName: "invest", args: [amount, shares * 99n / 100n] });`;

// Solidity needs the checksummed address literal.
const feedExample = `interface AggregatorV3Interface {
  function latestRoundData() external view
    returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

// USTX / USD on X Layer Testnet, 8 decimals
AggregatorV3Interface constant USTX_USD = AggregatorV3Interface(0x292c56c5290Cc7B73e3eE33c2C2688eB3e04c3c8);

function ustxInUsd() view returns (uint256) {
  (, int256 answer, , uint256 updatedAt, ) = USTX_USD.latestRoundData();
  require(block.timestamp - updatedAt <= 1 hours, "stale NAV"); // a record lands every five minutes
  return uint256(answer);
}`;

const marketExample = `import { parseAbi } from "viem";

const pool = "${FUND_DEPLOYMENT.pool}";      // USTX/dUSD pool
const arbitrage = "${FUND_DEPLOYMENT.arbitrage}"; // one-transaction NAV arbitrage
const abi = parseAbi([
  "function premiumBps() view returns (int256)",
  "function quote() view returns (bool buyInPool, uint256 dollarsIn, uint256 dollarsOut)",
  "function buyAndRedeem(uint256 dollarsIn, uint256 minProfit) returns (uint256)",
  "function investAndSell(uint256 dollarsIn, uint256 minProfit) returns (uint256)",
]);

const premium = await client.readContract({ address: pool, abi, functionName: "premiumBps" }); // -27n: 0.27% below NAV
const [buyInPool, dollarsIn, dollarsOut] = await client.readContract({ address: arbitrage, abi, functionName: "quote" });
if (dollarsIn > 0n) {
  // Approve dUSD to the arbitrage contract first. It reverts unless you get back at least dollarsIn + minProfit.
  await wallet.writeContract({ address: arbitrage, abi, functionName: buyInPool ? "buyAndRedeem" : "investAndSell", args: [dollarsIn, (dollarsOut - dollarsIn) / 2n] });
}`;

// A live arbitrage on X Layer Testnet: the pool was 17.3% below the NAV and closed to 0.27% below.
const ARBITRAGE_TX = "0x3c604c934a1ef7576a173e0b513c419ad89376f1c6bea17464f8c5afbb9f6c2e";

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
        <section id="invest"><h2>Invest from a wallet or a contract</h2><p>USTX is a token on X Layer Testnet. Its contract reads the latest USTX record from the registry and issues shares at that NAV when a wallet invests demo dollars (dUSD, no value); redeeming burns shares and pays demo dollars at the same NAV. Orders need a record at most an hour old and at least $10, round down, and take a minimum-output limit. No key can issue shares any other way, and <code>investorCount()</code> counts the wallets holding USTX.</p>
          <Code label="Invest with viem">{investExample}</Code>
          <div className="gmd-terms-links"><a className="gmd-inline-link" href={`${FUND_DEPLOYMENT.explorerUrl}/token/${FUND_DEPLOYMENT.fund}`} target="_blank" rel="noreferrer">USTX token on the OKX explorer <Icon name="external" size={14} /></a><a className="gmd-inline-link" href={`${FUND_DEPLOYMENT.explorerUrl}/token/${FUND_DEPLOYMENT.dollar}`} target="_blank" rel="noreferrer">dUSD demo dollars <Icon name="external" size={14} /></a></div>
        </section>
        <section id="feed"><h2>Read the NAV from a contract</h2><p>Contracts can price USTX too. <code>GanymedeNavFeed</code> serves the latest USTX record through <code>AggregatorV3Interface</code>, the interface Chainlink price feeds use, so a lending market, vault or dashboard that already reads Chainlink prices can read USTX by changing one address. Answers have 8 decimals. The round ID and <code>updatedAt</code> are the record’s effective time, so a staleness check measures the age of the prices. The feed has no owner and nothing to configure.</p>
          <Code label="Read the feed in Solidity">{feedExample}</Code>
          <div className="gmd-terms-links"><a className="gmd-inline-link" href={`${FUND_DEPLOYMENT.explorerUrl}/address/${FUND_DEPLOYMENT.feed}`} target="_blank" rel="noreferrer">USTX / USD feed on the OKX explorer <Icon name="external" size={14} /></a></div>
        </section>
        <section id="market"><h2>Trade USTX on X Layer</h2><p>USTX also trades on a USTX/dUSD pool on X Layer Testnet: a constant-product market with a 0.3% fee to liquidity providers. Its price moves only with trades, so it drifts from the NAV as the NAV moves. <code>GanymedeNavArbitrage</code> closes the gap in one transaction, the way ETF creation and redemption keep a fund near its NAV. Below the NAV it buys USTX in the pool and redeems it at the fund; above the NAV it invests at the fund and sells the new USTX in the pool. It reverts unless the caller gets back more than it put in, and <code>quote()</code> returns the size that captures most of the gap.</p>
          <Code label="Close the gap with viem">{marketExample}</Code>
          <div className="gmd-terms-links"><a className="gmd-inline-link" href={`${FUND_DEPLOYMENT.explorerUrl}/address/${FUND_DEPLOYMENT.pool}`} target="_blank" rel="noreferrer">USTX/dUSD pool on the OKX explorer <Icon name="external" size={14} /></a><a className="gmd-inline-link" href={`${FUND_DEPLOYMENT.explorerUrl}/tx/${ARBITRAGE_TX}`} target="_blank" rel="noreferrer">An arbitrage on X Layer Testnet <Icon name="external" size={14} /></a></div>
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
            <li><b>X Layer Testnet</b><span>Holds the NAV registry (every NAV, its composition fingerprint and the shares outstanding), the USTX token, which issues shares only at the recorded NAV, a feed that serves that NAV to other contracts in the Chainlink interface, and a USTX/dUSD pool whose gap to the NAV any wallet can close in one transaction.</span></li>
            <li><b>X Layer mainnet</b><span>Where the xStocks live. Portfolio reads any wallet’s xStock balances directly from mainnet.</span></li>
            <li><b>OKX Wallet</b><span>Invests and redeems USTX on X Layer Testnet from the USTX page, and shows its balances on Portfolio.</span></li>
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
  ["Sell it, and let investors check", "Investors buy and redeem from their own wallets at the recorded NAV and verify every price in their own browser. Partners embed the badge or read the API."],
] as const;

const plans = [
  { name: "Sandbox", price: "Free", note: "Available now on X Layer Testnet", items: ["NAV records every five minutes", "Investor app with demo balances", "Public API and verified badge"] },
  { name: "Issuer", price: "Contact us", note: "X Layer mainnet", items: ["Your own basket and branding", "Mainnet NAV records", "Full evidence archive"] },
  { name: "Distribution", price: "Contact us", note: "With licensed partners", items: ["Listing in the Ganymede app", "Partner wallets and sites", "Investor reporting"] },
] as const;

export function IssuersPage() {
  return <ProductShell><Link className="gmd-breadcrumb" prefetch={false} href="/"><Icon name="back" size={16} />Markets</Link>
    <div className="gmd-document-layout"><DocumentMenu current="issuers" />
      <article className="gmd-document"><header><h1>Launch a basket investors can verify.</h1><p>Ganymede turns tokenized stocks on X Layer into a fund product with a NAV anyone can check: priced by OKX OnchainOS, recorded on X Layer every five minutes and verified in the investor’s own browser.</p></header>
        <section id="why"><h2>Why it matters</h2><p>Tokenized stocks such as xStocks already trade on X Layer, but a basket built from them usually asks investors to trust the issuer’s price. Ganymede publishes the evidence with every price, so a wallet, an exchange or an investor can confirm the NAV without asking anyone. That makes a basket easier to list, easier to distribute and harder to misprice.</p></section>
        <section id="how"><h2>How it works</h2><ol className="gmd-steps">{steps.map(([title, copy], index) => <li key={title}><span>{index + 1}</span><div><b>{title}</b><p>{copy}</p></div></li>)}</ol></section>
        <section id="get"><h2>What you get</h2><ul className="gmd-stack-list">
          <li><b>An investor app</b><span>Markets, a product page with fund figures, invest and redeem from a wallet, and a portfolio that looks through to every token.</span></li>
          <li><b>A share token</b><span>A token on X Layer that issues and redeems shares only at the NAV in the registry, and counts its holders on chain.</span></li>
          <li><b>Verification built in</b><span>A transparency page with a tamper experiment, evidence files and an open-source verifier.</span></li>
          <li><b>Distribution tools</b><span>A public NAV API and a badge any partner can embed, both backed by the record on X Layer.</span></li>
          <li><b>Operations</b><span>Scheduled pricing, publication with idempotent retries, and rate-limit handling for the price provider.</span></li>
        </ul><Link prefetch={false} className="gmd-inline-link" href="/products/ustx">See it working with USTX <Icon name="arrow" size={16} /></Link></section>
        <section id="plans"><h2>Plans</h2><div className="gmd-plans">{plans.map(plan => <article key={plan.name}><span>{plan.note}</span><h3>{plan.name}</h3><strong>{plan.price}</strong><ul>{plan.items.map(item => <li key={item}><Icon name="check" size={15} />{item}</li>)}</ul></article>)}</div><p className="gmd-caption">Real-money services are offered only with licensed partners in the markets they serve.</p></section>
        <footer><p>Launching a basket, listing USTX or showing its NAV in your app? Get in touch on GitHub.</p><div className="gmd-terms-links"><a className="gmd-button" href={`${REPOSITORY}/issues`} target="_blank" rel="noreferrer">Contact us on GitHub <Icon name="external" size={16} /></a><Link prefetch={false} className="gmd-inline-link" href="/developers">Developer docs <Icon name="arrow" size={16} /></Link></div></footer>
      </article></div></ProductShell>;
}
