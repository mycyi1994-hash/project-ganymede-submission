import HomeClient from "./HomeClient";

export default async function Home({ searchParams }: {
  searchParams: Promise<{ app?: string | string[] }>;
}) {
  const { app } = await searchParams;
  const initialView = app === "select" || app === "portfolio" || app === "operations" ? app : "overview";
  return <HomeClient initialView={initialView} />;
}
