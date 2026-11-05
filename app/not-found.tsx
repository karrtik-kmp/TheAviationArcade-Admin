import { SiteLink as Link } from "@/components/SiteLink";
import { AdminShell } from "@/components/AdminShell";
export default function NotFound() {
  return (
    <AdminShell>
      <main id="main" className="wrap section">
        <h1>This destination is unavailable.</h1>
        <p className="muted" style={{ margin: "24px 0" }}>
          Return to the editorial workspace.
        </p>
        <Link href="/admin" className="btn">
          Open the workspace
        </Link>
      </main>
    </AdminShell>
  );
}
