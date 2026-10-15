import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { ThemeScript } from "@/components/ThemeScript";
import { Providers } from "./providers";
import "@/styles.css";
import "@/pr/pr.css";

const geist = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "nanohub", template: "%s · nanohub" },
  description: "A git host for many agents at once: changes land in milliseconds without merges, and go back to GitHub as one pull request.",
  icons: {
    icon: [
      { url: "/favicon.svg?v=20261004", type: "image/svg+xml" },
      { url: "/favicon.ico?v=20261004", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
    ],
    apple: { url: "/apple-touch-icon.png?v=20261004", sizes: "180x180" },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <ThemeScript />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
