import { redirect } from "next/navigation";
import { ProductShell } from "./product-ui/ProductShell";
import { MarketScreen } from "./product-ui/ProductScreens";

export default async function Home({ searchParams }: {
  searchParams: Promise<{ app?: string | string[] }>;
}) {
  const { app } = await searchParams;
  if (app === "select") redirect("/products/ustx");
  if (app === "portfolio") redirect("/portfolio");
  return <ProductShell><MarketScreen /></ProductShell>;
}
