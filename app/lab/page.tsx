import { redirect } from "next/navigation";

// The earlier won-denominated paper Lab is retired from the public site; the product's portfolio
// is in US dollars.
export default function LabPage() { redirect("/portfolio"); }
