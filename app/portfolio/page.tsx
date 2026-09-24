import { ProductShell } from "../product-ui/ProductShell";
import { LedgerScreen } from "../product-ui/LedgerScreens";
export const metadata = { title: "Portfolio · Ganymede" };
export default function PortfolioPage() { return <ProductShell section="portfolio"><LedgerScreen /></ProductShell>; }
