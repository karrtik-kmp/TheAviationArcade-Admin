import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { sitePath } from "@/lib/paths";
import { setting } from "@/lib/settings";
import { publicWebsiteUrl } from "@/lib/website-url";

export const metadata: Metadata = {
  title: {
    default: "Airplane Games | The Aviation Arcade",
    template: "%s | Airplane Games",
  },
  description:
    "Discover eight aviation games, explore Plane of the Day, and share your aviation photography.",
  robots: { index: false, follow: false },
  icons: {
    icon: sitePath("/media/favicon.png"),
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read per request (headers()), so the hosted value of PUBLIC_SITE_URL applies, not the build-time one.
  const publicSite = publicWebsiteUrl((await headers()).get("host"), setting("PUBLIC_SITE_URL"));
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href={sitePath("/fonts/BarlowCondensed-SemiBold.woff2")}
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href={sitePath("/fonts/Poppins-Regular.woff2")}
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <Providers publicSite={publicSite}>{children}</Providers>
      </body>
    </html>
  );
}
