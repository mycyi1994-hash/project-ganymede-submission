import Link from "next/link";
import { PageGuide, ProductShell } from "./product-ui/ProductShell";
import { Icon } from "./product-ui/Icons";
import { DocumentBar, DocumentMenu } from "./product-ui/DocumentMenu";

const guides = {
  methodology: {
    title: "How your basket is priced.",
    intro: "USTX follows nine US technology companies through their xStocks. Its net asset value (NAV) is the combined value of the holdings represented by one share.",
    sections: [
      ["Nine holdings, one basket", "Apple, Microsoft, NVIDIA, Amazon, Meta, Tesla, Alphabet, Oracle and Palantir start at approximately 11.11% each. Their weights move with market prices between quarterly rebalances."],
      ["A price for every holding", "Each share represents a fixed amount of each xStock until the next rebalance. We multiply those amounts by their OKX OnchainOS prices and add the results. Each holding’s value is rounded down to six decimal places before adding."],
      ["Updated every five minutes", "New prices are published on X Layer Testnet every five minutes when all required prices are available. The price time is shown beside the NAV. Orders and loans require a price less than one hour old."],
      ["Two market sources, checked on your device", "The Transparency page compares the basket’s value at OKX prices with its value at xStock pool prices on X Layer mainnet. The comparison range is 1% of the whole basket’s NAV. Your browser also recalculates the holdings and checks that the price and supporting data match the published X Layer record. The browser checks the calculation; it is not another market price source."],
      ["Quarterly rebalancing", "At the first available price update in each new calendar quarter, holdings return to equal weights at the basket’s current value. Changes to the constituent list use the same approach. Small rounding differences can occur. Adjustments by token issuers, including dividends and splits, are not reflected in the fixed amounts until the next rebalance."],
      ["Understanding fund size", "Fund size is the recorded number of shares multiplied by the NAV. Every share is a USTX token held in a wallet on X Layer Testnet. USTX is a demo fund: these figures do not represent real assets held in custody."],
    ],
  },
  limitations: {
    title: "Understand what you’re using.",
    intro: "Ganymede lets you explore stock baskets with demo funds. Price checks make the calculation easier to inspect, but do not guarantee asset backing, an executable price or an investment return.",
    sections: [
      ["Demo funds, no real asset ownership", "Demo dollars and USTX have no real value. No real money moves, and Ganymede does not hold the underlying xStocks. Orders run only on X Layer Testnet, from your own wallet, with demo dollars (dUSD) that have no value. They create no legal rights to real stocks. The smart contracts are unaudited."],
      ["Investing from your wallet", "Connect OKX Wallet on X Layer Testnet, claim demo dollars (dUSD) there, and invest from $10. Orders use the latest available NAV under one hour old; real funds may use different execution rules. Your USTX is a token in your own wallet, so it stays with you and shows on Portfolio. Aggregate fund activity is public, read from the contracts on X Layer."],
      ["Market prices can differ", "OKX and Uniswap pools both price xStocks on X Layer mainnet. These prices may differ from the underlying stocks’ exchange prices, and thin liquidity or large trades can move them. Both sources can agree and still be wrong. Pool valuations treat their dollar stablecoins as $1, which may not hold during a depeg."],
      ["What the 1% comparison means", "The comparison applies to the whole basket, not each stock. A new USTX price is withheld when the pool-based basket value differs by more than 1%. If pool prices cannot be reached, a price can still be published, but the comparison remains unavailable. The Transparency page repeats the comparison with current pool prices, which may have moved since publication."],
      ["Updates and availability", "Updates can be delayed. A correctly verified historical price may still be old: always check its timestamp. Missing prices or prices too far apart in time prevent a new NAV. Orders and loans stop accepting a price after one hour. Network or price-provider interruptions can also affect trading and verification."],
      ["What checking a price proves", "The check confirms that the holdings, calculation and published record agree. It does not confirm stock-market prices, custody or contract security. This site supplies the checking software and relies on X Layer network access. Published records can also be checked independently."],
      ["Price history", "Price history remains on X Layer. Full supporting holdings are available for the latest 12 updates, around one hour. Older prices may still be visible even when their detailed holdings can no longer be checked here."],
      ["Liquidity and borrowing", "Pool prices can move before an order completes, and providing liquidity can lose value relative to holding the tokens. A loan can be liquidated when it exceeds 65% of its USTX collateral value. Review each pool’s fees and your loan position before proceeding."],
    ],
  },
};

export default function ProductGuide({ kind }: { kind: keyof typeof guides }) {
  const guide = guides[kind];
  return <ProductShell><DocumentBar current={kind} parent={{ href: "/products/ustx", label: "US Tech Basket" }} /><PageGuide />
    <div className="gmd-document-layout"><DocumentMenu current={kind} />
      <article className="gmd-document"><header><h1>{guide.title}</h1><p>{guide.intro}</p></header>
        {guide.sections.map(([title, copy]) => <section key={title}><h2>{title}</h2><p>{copy}</p></section>)}
        <footer><p>For demo investing. Not investment advice.</p><Link className="gmd-button" href="/products/ustx">Explore USTX <Icon name="arrow" size={16} /></Link></footer>
      </article></div></ProductShell>;
}
