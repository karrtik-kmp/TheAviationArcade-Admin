"use client";
import { ThemeProvider } from "next-themes";
import { AccountSessionProvider } from "@/components/AccountSession";
import { DevDemoWaiverProvider, PublicSiteProvider } from "@/components/PublicSite";
export function Providers({
  children,
  publicSite = null,
  devDemoWaiver = false,
}: {
  children: React.ReactNode;
  publicSite?: string | null;
  devDemoWaiver?: boolean;
}) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <PublicSiteProvider value={publicSite}>
        <DevDemoWaiverProvider value={devDemoWaiver}>
          <AccountSessionProvider>{children}</AccountSessionProvider>
        </DevDemoWaiverProvider>
      </PublicSiteProvider>
    </ThemeProvider>
  );
}
