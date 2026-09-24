import { notFound } from "next/navigation";
import { ProductShell } from "../../product-ui/ProductShell";
import { LedgerTransaction } from "../../product-ui/LedgerScreens";
export const metadata = { title: "Share transaction · Ganymede" };
export default async function TransactionPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) notFound();
  return <ProductShell section="activity"><LedgerTransaction key={hash} hash={hash} /></ProductShell>;
}
