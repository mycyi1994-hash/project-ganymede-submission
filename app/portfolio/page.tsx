import { ProductShell } from "../product-ui/ProductShell";
import WalletPortfolio from "../product-ui/WalletPortfolio";
export const metadata = { title: "Portfolio · Ganymede" };
export default function PortfolioPage() { return <ProductShell section="portfolio"><WalletPortfolio /></ProductShell>; }
