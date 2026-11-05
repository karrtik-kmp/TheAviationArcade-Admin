"use client";
import { SiteLink as Link } from "@/components/SiteLink";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "@phosphor-icons/react";
import { AccountControl } from "@/components/AccountControl";
import "@/components/account.css";
import { sitePath } from "@/lib/paths";
export function Brand() {
  return (
    <Link href="/admin" className="brand" aria-label="Airplane Games editorial workspace">
      <img src={sitePath("/media/logo-144.webp")} alt="" width="48" height="48" />
      <div className="brand-name">
        Airplane Games
        <span className="brand-descriptor">The Aviation Arcade</span>
      </div>
    </Link>
  );
}
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={
        mounted && resolvedTheme === "dark"
          ? "Use light theme"
          : "Use dark theme"
      }
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun size={18} />
      ) : (
        <Moon size={18} />
      )}
    </button>
  );
}
/** The Admin's frame for pages outside the workspace itself: gates, sign-out, not found. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="wrap header-inner">
          <Brand />
          <div className="header-actions">
            <ThemeToggle />
            <AccountControl />
          </div>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-bottom">
            <span>Airplane Games editorial workspace.</span>
            <div className="actions">
              <span>Authorized staff only</span>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
