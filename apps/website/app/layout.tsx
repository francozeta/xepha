import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistPixelLine } from "geist/font/pixel";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

const title = "Xepha";
const description = "Local memory for project history, decisions, and context.";
const authorUrl = "https://github.com/francozeta";
const siteUrl = "https://xepha.vercel.app/";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: `%s | ${title}`,
  },
  description,
  applicationName: title,
  authors: [{ name: "francozeta", url: authorUrl }],
  creator: "francozeta",
  publisher: "francozeta",
  keywords: [
    "Xepha",
    "local-first",
    "project memory",
    "developer tools",
    "software context",
    "coding agents",
    "open source",
  ],
  category: "developer tools",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: title,
    type: "website",
    locale: "en_US",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${GeistPixelLine.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
