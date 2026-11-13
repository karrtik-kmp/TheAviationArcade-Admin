"use client";
import { ThemeProvider } from "next-themes";
import { AccountSessionProvider } from "@/components/AccountSession";
import { PublicSiteProvider } from "@/components/PublicSite";
export function Providers({
  children,
  publicSite = null,
}: {
  children: React.ReactNode;
  publicSite?: string | null;
}) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <PublicSiteProvider value={publicSite}>
        <AccountSessionProvider>{children}</AccountSessionProvider>
      </PublicSiteProvider>
    </ThemeProvider>
  );
}
