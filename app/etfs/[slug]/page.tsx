import { notFound } from "next/navigation";
import { etfs, getEtfBySlug } from "../../data/etfs";
import EtfDetailClient from "./EtfDetailClient";

export function generateStaticParams() {
  return etfs.map((etf) => ({ slug: etf.slug }));
}

export default async function EtfDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const etf = getEtfBySlug(slug);
  if (!etf) notFound();
  return <EtfDetailClient etf={etf} />;
}
