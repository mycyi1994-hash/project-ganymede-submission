import type { Metadata } from "next";
import ProofClient from "./ProofClient";

export const metadata: Metadata = {
  title: "Proof of NAV · Ganymede Index",
  description: "Inspect the last recorded NAV of GMD USTX and compare its published composition with the record on X Layer Testnet, in your browser.",
};

export default function ProofPage() {
  return <ProofClient />;
}
