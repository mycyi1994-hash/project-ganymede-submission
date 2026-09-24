import { notFound } from "next/navigation";
import { ProductShell, type DesignScreen } from "../product-ui/ProductShell";
import { MarketScreen } from "../product-ui/ProductScreens";
import { ActivityDesignPreview, HoldingDesignPreview, PortfolioDesignPreview, ProductDesignPreview, TransactionDesignPreview } from "../product-ui/DesignPreview";

export const metadata = { title: "Local design preview · Ganymede", robots: { index: false, follow: false } };
export default async function DesignPreviewPage({ searchParams }: { searchParams: Promise<{ screen?: string; scenario?: string; amount?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  const screen: DesignScreen = (["product", "order", "portfolio", "holding", "activity", "transaction"] as string[]).includes(params.screen ?? "") ? params.screen as DesignScreen : "markets";
  const scenario = ["pending", "completed", "recovery"].includes(params.scenario ?? "") ? params.scenario : "pending";
  const input = Number(params.amount);
  const amount = params.amount && /^\d+(\.\d{1,2})?$/.test(params.amount) && input >= 25 && input <= 12525 ? input : undefined;
  return <ProductShell preview={screen} section={["portfolio", "holding"].includes(screen) ? "portfolio" : ["activity", "transaction"].includes(screen) ? "activity" : "markets"}>{screen === "markets" ? <MarketScreen preview /> : screen === "holding" ? <HoldingDesignPreview /> : screen === "portfolio" ? <PortfolioDesignPreview /> : screen === "activity" ? <ActivityDesignPreview /> : screen === "transaction" ? <TransactionDesignPreview scenario={scenario} amount={amount} /> : <ProductDesignPreview key={screen} order={screen === "order"} />}</ProductShell>;
}
