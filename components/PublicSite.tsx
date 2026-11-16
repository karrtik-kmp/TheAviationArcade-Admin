"use client";
import { createContext, useContext, type ReactNode } from "react";

/**
 * The public website's origin (`<origin>/`) for links that leave the Admin, such as "My account" and
 * "Contribute", which live on the website and 404 on the admin host. Null when none is known (local hosts
 * without `PUBLIC_SITE_URL`); those links are then left out. Set by the root layout (lib/website-url.ts).
 */
const PublicSiteContext = createContext<string | null>(null);

export function PublicSiteProvider({ value, children }: { value: string | null; children: ReactNode }) {
  return <PublicSiteContext.Provider value={value}>{children}</PublicSiteContext.Provider>;
}

export function usePublicSite(): string | null {
  return useContext(PublicSiteContext);
}

/**
 * Whether the dev demo waiver relaxes the browser pre-checks on this page (lib/dev-waiver.ts). Set by the root
 * layout; false on any host other than dev.admin.<domain> or loopback. It authorizes nothing: the backend decides.
 */
const DevDemoWaiverContext = createContext(false);

export function DevDemoWaiverProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <DevDemoWaiverContext.Provider value={value}>{children}</DevDemoWaiverContext.Provider>;
}

export function useDevDemoWaiver(): boolean {
  return useContext(DevDemoWaiverContext);
}
