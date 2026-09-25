import Link from "next/link";
import { ProductShell } from "./product-ui/ProductShell";
import { Icon } from "./product-ui/Icons";
import { DocumentMenu } from "./product-ui/DocumentMenu";

const guides = {
  methodology: {
    title: "How one model share is valued.",
    intro: "GMD USTX is a model basket of AAPLx, MSFTx, NVDAx, AMZNx, METAx and TSLAx. Its published data lets you reproduce the calculation.",
    sections: [
      ["Fix the basket", "The inception target is $100 per model share. Equal weights are represented in basis points: four holdings receive 16.67% and two receive 16.66%, totaling 100%. Token units are fixed using the eligible prices at inception. At the first eligible evaluation in a new calendar quarter, units are re-fixed at the prevailing basket value; rounding can produce small differences."],
      ["Calculate holding values", "Token units use 18 decimal places. USD prices and values use 6 decimal places. Each holding value is floor(unitsWad × priceMicros / 10^18). NAV is the sum of those integer holding values. The interface rounds numbers for readability; verification uses the full integer values."],
      ["Publish the document fingerprint", "A composition document includes token addresses, fixing weights, units, prices, price timestamps, holding values and the total NAV. Object keys are sorted recursively to produce canonical JSON. SHA-256 of those exact bytes becomes the holdings hash. The relayer submits the NAV, hash and effective time to the X Layer Testnet registry."],
      ["Check the record", "Your browser reads the pinned registry on chain 1952, hashes the corresponding original document and recomputes all holding values. A match means the document, calculation and recorded NAV agree. Missing evidence remains unverified. The developer page (/developers#verify) also edits a browser copy three ways to show which check catches each change, and offers an evidence file that npm run verify:evidence re-checks against the publishing transaction's NavPublished event."],
      ["Record the shares outstanding", "Each NAV record also carries the USTX shares outstanding when the NAV was taken, in wallets and in demo balances, so the fund size shown in the app is the recorded shares multiplied by the recorded NAV. A retried publication sends the count stored with it, never a newer one."],
      ["When constituents or tokens change", "The six constituents are fixed in code. If the set changed, the basket would start a new series at $100 rather than continue the old one. If a constituent token moved to a new address, units would be re-fixed at the prevailing basket value, which assumes the new token is worth the same as the old one. Dividends and splits are not modelled: where the token issuer adjusts holder balances, the model's fixed units do not change until the next re-fixing."],
    ],
  },
  limitations: {
    title: "What the evidence can tell you.",
    intro: "A consistent NAV record is useful evidence about a calculation. It is not evidence that a fund holds the assets, that a price is executable, or that an investment is safe.",
    sections: [
      ["Demo investing, testnet record", "Investing on Ganymede uses demo dollars. No real money moves, and Ganymede does not hold or custody the xStocks. Wallet orders issue USTX tokens on X Layer Testnet; demo-balance shares stay in the demo ledger. Constituent prices come from X Layer mainnet (196); NAV records are published to X Layer Testnet (1952). Smart contracts are unaudited. Testnet records do not establish legal rights or asset backing."],
      ["How demo orders work", "Each browser gets a private demo account with $10,000 in demo dollars, identified by a cookie that is stored only as a hash. Orders of $10 or more fill instantly at the latest NAV recorded on X Layer, provided it is under an hour old; a live fund would fill at the next NAV instead. A daily limit on orders across all accounts protects the database budget that NAV publication depends on. Fund totals and recent orders are shown publicly without anything that identifies an account. Resetting starts the account again with $10,000."],
      ["Two price sources", "USTX records OKX OnchainOS DEX market prices. Provider timestamps do not guarantee the time of the last trade. Before each record, the publisher compares them with a second source read directly from X Layer mainnet: the Uniswap V3 pool where each xStock’s ERC-4626 wrapper trades against USDG or USDC, converted at the wrapper’s rate and counting the stablecoin as $1. A NAV more than 1% from its value at the pool prices is not recorded; if the pools cannot be read, the record goes ahead with a warning. The Transparency page repeats the comparison in your browser. Both sources are X Layer markets: their prices may be delayed, illiquid or moved by a large trade, need not equal the underlying shares’ exchange prices, and a price wrong in both passes these checks."],
      ["Price eligibility and delayed updates", "OnchainOS stamps each quote with the time of the response, and a quote more than 10 minutes old (the default, configurable by the operator) or a missing constituent price blocks a new NAV, as do prices quoted more than a minute apart; USTX does not substitute reference prices. A record’s time is the time of its oldest price, never later than the calculation, and the browser check fails if any price in the document is more than a minute older than that time, or if the record claims a time more than a minute after the block that wrote it; the USTX fund and the lending market accept a record for one hour after it, so the hour counts from the prices. The displayed cycle-delay warning starts after 15 minutes without a recent pricing attempt. These are different checks, and neither guarantees quote accuracy."],
      ["Publication can fail", "The NAV record is scheduled every five minutes, but provider limits, database limits, RPC or relayer failures can delay publication. A rate-limited price request is asked again 30 and 90 seconds later, then at the next cycle. Pricing success and chain confirmation are separate states. A historical record can pass consistency checks even when the next update is delayed. Sampled health checks do not establish uninterrupted uptime."],
      ["Browser verification limits", "The browser relies on the pinned public RPC and the deployed verifier code. A matching hash shows agreement with the registry, not that the issuer's inputs were true. The tamper experiment changes a browser copy only; it does not test custody, trading or contract security."],
      ["Document retention", "The service keeps the original documents for the latest 12 publications, about one hour. Older NAVs and fingerprints remain on X Layer, but their documents are no longer served. An evidence file downloaded at the time still verifies against its transaction."],
      ["A shared registry", "The same X Layer Testnet registry also carries NAV records for Ganymede's earlier paper strategies under a different product key. The USTX check reads only the USTX key. The GMDCORE test share ledger comes from the same earlier work; its supply is zero and it is not a claim on USTX."],
    ],
  },
};

export default function ProductGuide({ kind }: { kind: keyof typeof guides }) {
  const guide = guides[kind];
  return <ProductShell><Link className="gmd-breadcrumb" href="/products/ustx"><Icon name="back" size={16} />US Tech Basket</Link>
    <div className="gmd-document-layout"><DocumentMenu current={kind} />
      <article className="gmd-document"><header><h1>{guide.title}</h1><p>{guide.intro}</p></header>
        {guide.sections.map(([title, copy]) => <section key={title}><h2>{title}</h2><p>{copy}</p></section>)}
        <footer><p>This describes the current model and its data. It is not an offering document.</p><Link className="gmd-button" href="/products/ustx">Back to basket <Icon name="arrow" size={16} /></Link></footer>
      </article></div></ProductShell>;
}
