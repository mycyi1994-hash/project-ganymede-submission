import Link from "next/link";
import { ProductShell } from "./product-ui/ProductShell";
import { Icon } from "./product-ui/Icons";

const guides = {
  methodology: {
    title: "How one model share is valued.",
    intro: "GMD USTX is a model basket of AAPLx, MSFTx, NVDAx, AMZNx, METAx and TSLAx. Its published data lets you reproduce the calculation.",
    sections: [
      ["Fix the basket", "The inception target is $100 per model share. Equal weights are represented in basis points: four holdings receive 16.67% and two receive 16.66%, totaling 100%. Token units are fixed using the eligible prices at inception. At the first eligible evaluation in a new calendar quarter, units are re-fixed at the prevailing basket value; rounding can produce small differences."],
      ["Calculate holding values", "Token units use 18 decimal places. USD prices and values use 6 decimal places. Each holding value is floor(unitsWad × priceMicros / 10^18). NAV is the sum of those integer holding values. The interface rounds numbers for readability; verification uses the full integer values."],
      ["Publish the document fingerprint", "A composition document includes token addresses, fixing weights, units, prices, price timestamps, holding values and the total NAV. Object keys are sorted recursively to produce canonical JSON. SHA-256 of those exact bytes becomes the holdings hash. The relayer submits the NAV, hash and effective time to the X Layer Testnet registry."],
      ["Check the record", "Your browser reads the pinned registry on chain 1952, hashes the corresponding original document and recomputes all holding values. A match means the document, calculation and recorded NAV agree. Missing evidence remains unverified. Optional experiments are in the separate Lab."],
    ],
  },
  limitations: {
    title: "What the evidence can tell you.",
    intro: "A consistent NAV record is useful evidence about a calculation. It is not evidence that a fund holds the assets, that a price is executable, or that an investment is safe.",
    sections: [
      ["Model basket, testnet record", "Ganymede does not hold or custody the modeled xStocks and offers no fund shares to the public. Constituent prices come from X Layer mainnet (196); NAV records are published to X Layer Testnet (1952). Smart contracts are unaudited. Testnet records do not establish legal rights or asset backing."],
      ["One pricing source", "USTX uses OKX OnchainOS DEX market prices. Provider timestamps do not guarantee the time of the last trade. Prices may be delayed, illiquid or inaccurate and need not equal underlying stock-market prices. No independent second-price-source comparison is implemented."],
      ["Price eligibility and delayed updates", "The quote-age default in the code is 360 minutes, configurable by the operator. Quotes outside the configured limit or missing constituent prices block a new NAV; USTX does not substitute reference prices. The displayed cycle-delay warning starts after 15 minutes without a recent pricing attempt. These are different checks, and neither guarantees quote accuracy. Transparency shows the configured quote-age limit with its calculation details."],
      ["Publication can fail", "The engine is scheduled every five minutes, but provider limits, database limits, RPC or relayer failures can delay publication. Pricing success and chain confirmation are separate states. A historical record can pass consistency checks even when the next update is delayed. Sampled health checks do not establish uninterrupted uptime."],
      ["Browser verification limits", "The browser relies on the pinned public RPC and the deployed verifier code. A matching hash shows agreement with the registry, not that the issuer's inputs were true. A price change in the local experiment changes a browser copy only; it does not test custody, trading or contract security."],
    ],
  },
};

export default function ProductGuide({ kind }: { kind: keyof typeof guides }) {
  const guide = guides[kind];
  return <ProductShell><Link className="gmd-breadcrumb" href="/products/ustx"><Icon name="back" size={16} />US Tech Basket</Link>
    <div className="gmd-document-layout"><aside className="gmd-document-menu"><span>Product information</span><nav aria-label="Product documents"><Link href="/methodology" aria-current={kind === "methodology" ? "page" : undefined}>Methodology</Link><Link href="/limitations" aria-current={kind === "limitations" ? "page" : undefined}>Limits & data policy</Link><Link href="/products/ustx/transparency">Transparency</Link></nav></aside>
      <article className="gmd-document"><header><h1>{guide.title}</h1><p>{guide.intro}</p></header>
        {guide.sections.map(([title, copy]) => <section key={title}><h2>{title}</h2><p>{copy}</p></section>)}
        <section id="paper-strategies"><h2>The separate paper strategy lab</h2><p>CORE and YIELD are passive crypto model strategies; TECH and ALPHA use systematic active rules. The Lab holds sample allocations for this browser for 30 days. Clearing cookies or using another browser starts a separate paper portfolio. These simulations are separate from USTX; no real money moves.</p><Link className="gmd-inline-link" href="/lab#paper-strategy-lab">Explore Lab <Icon name="arrow" size={16} /></Link></section>
        <footer><p>This describes the current model and its data. It is not an offering document.</p><Link className="gmd-button" href="/products/ustx">Back to basket <Icon name="arrow" size={16} /></Link></footer>
      </article></div></ProductShell>;
}
