import { redirect } from "next/navigation";

// The earlier GMDCORE test share ledger is retired from the public site: activity is the market's.
export default function ActivityPage() { redirect("/products/ustx#activity"); }
