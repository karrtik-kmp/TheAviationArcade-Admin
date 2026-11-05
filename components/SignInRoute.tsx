import { headers } from "next/headers";
import { AuthForm } from "@/components/AuthForm";
import { Brand } from "@/components/AdminShell";
import {
  audiences,
  safeAccountReturn,
  type Audience,
} from "@/lib/account";
import { publicWebsiteUrl } from "@/lib/website-url";
import { redirectIfSignedIn } from "@/lib/access";
import "@/components/account.css";
import "@/components/admin-sign-in.css";

export type SignInSearchParams = Promise<{
  return_to?: string | string[];
  as?: string | string[];
}>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** The safe app path to land on for `audience`, defaulting to its home. */
function landing(audience: Audience, value: string | undefined) {
  const safe = safeAccountReturn(value);
  return safe === "/" ? audiences[audience].home : safe;
}

/** /admin/sign-in: the editors' own page, framed like the workspace rather than the public site. */
export async function AdminSignInRoute({
  searchParams,
}: {
  searchParams: SignInSearchParams;
}) {
  const returnTo = landing("admin", first((await searchParams).return_to));
  await redirectIfSignedIn("admin", returnTo);
  const website = publicWebsiteUrl((await headers()).get("host"));
  return (
    <div className="admin-signin">
      <aside className="admin-signin-panel">
        <Brand />
        <div className="admin-signin-copy">
          <p className="eyebrow">Editorial workspace</p>
          <h2>Review photo proposals and publish the collection.</h2>
          <ul>
            <li>Authorized staff accounts only</li>
            <li>The shared demo account is view only</li>
            <li>Every editorial change is recorded</li>
          </ul>
        </div>
        {website && (
          <a className="admin-signin-back" href={website}>
            ← Back to the website
          </a>
        )}
      </aside>
      <main id="main" className="admin-signin-main">
        <AuthForm audience="admin" returnTo={returnTo} />
      </main>
    </div>
  );
}
