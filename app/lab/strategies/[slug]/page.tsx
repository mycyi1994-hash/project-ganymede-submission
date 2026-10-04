import { notFound, redirect } from "next/navigation";
import { getEtfBySlug } from "../../../data/etfs";

// The earlier won-denominated paper strategies are retired from the public site: their links open USTX.
export default async function LabStrategyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getEtfBySlug(slug)) notFound();
  redirect("/products/ustx");
}
