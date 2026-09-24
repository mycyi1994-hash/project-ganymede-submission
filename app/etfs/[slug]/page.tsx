import { notFound, redirect } from "next/navigation";
import { getEtfBySlug } from "../../data/etfs";

export default async function LegacyStrategy({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getEtfBySlug(slug)) notFound();
  redirect(`/lab/strategies/${slug}`);
}
