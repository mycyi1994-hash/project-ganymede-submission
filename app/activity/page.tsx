import { ProductShell } from "../product-ui/ProductShell";
import { LedgerScreen } from "../product-ui/LedgerScreens";
export const metadata = { title: "Activity · Ganymede" };
export default function ActivityPage() { return <ProductShell section="activity"><LedgerScreen activity /></ProductShell>; }
