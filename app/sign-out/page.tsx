import { AdminShell } from "@/components/AdminShell";
import { SignOutPage } from "@/components/SignOutPage";

export const dynamic = "force-dynamic";

export default function SignOutRoute() {
  return (
    <AdminShell>
      <SignOutPage />
    </AdminShell>
  );
}
