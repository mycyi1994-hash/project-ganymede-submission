import { notFound, redirect } from "next/navigation";
import { ProductShell } from "../../product-ui/ProductShell";
import { FundScreen } from "../../product-ui/Funds";
import { IncomeScreen } from "../../product-ui/Income";
import { incomeFund, otherFund, USTX_FUND } from "@/lib/funds/catalog";

export const metadata = { title: "Funds · Ganymede", description: "A product on xStocks, priced by OKX OnchainOS and recorded on X Layer every five minutes." };

export default async function FundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === USTX_FUND.id) redirect(USTX_FUND.href);
  if (incomeFund(id)) return <ProductShell><IncomeScreen id={id} /></ProductShell>;
  if (!otherFund(id)) notFound();
  return <ProductShell><FundScreen id={id} /></ProductShell>;
}
