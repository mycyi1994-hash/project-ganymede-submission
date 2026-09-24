import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { etfs, getEtfBySlug } from "../../../data/etfs";
import EtfDetailClient from "../../../etfs/[slug]/EtfDetailClient";

export function generateStaticParams() {
  return etfs.map((etf) => ({ slug: etf.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const etf = getEtfBySlug(slug);
  if (!etf) return {};
  return {
    title: `${etf.ticker} paper strategy · Ganymede`,
    description: `${etf.tagline} A crypto model strategy in the Ganymede paper lab: simulation only, no real money moves.`,
  };
}

export default async function EtfDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const etf = getEtfBySlug(slug);
  if (!etf) notFound();
  return <EtfDetailClient etf={etf} />;
}
