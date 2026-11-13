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
