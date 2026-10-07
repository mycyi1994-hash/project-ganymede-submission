import { ProductShell } from "../product-ui/ProductShell";
import { BorrowScreen } from "../product-ui/Lending";
export const metadata = { title: "Borrow · Ganymede" };
export default function BorrowPage() { return <ProductShell section="borrow"><BorrowScreen /></ProductShell>; }
