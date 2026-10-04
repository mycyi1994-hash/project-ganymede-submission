import { redirect } from "next/navigation";

// The verification exercise lives on the developer page.
export default function VerificationLabPage() { redirect("/developers#verify"); }
