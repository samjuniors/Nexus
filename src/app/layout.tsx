import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f131a" },
    { media: "(prefers-color-scheme: light)", color: "#f7f9fc" },
  ],
};

export const metadata: Metadata = {
  title: "Nexus Agent",
  description:
    "Autonomous AI Agent OS that plans missions, loads skills, uses tools, plugins, MCP servers and subagents with graph memory.",
  keywords: ["AI agent", "autonomous agent", "plugins", "MCP", "tools", "skills"],
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nexus Eva",
  },
  openGraph: {
    title: "Nexus Agent",
    description:
      "Autonomous AI Agent OS that plans missions, loads skills, uses tools, plugins, MCP servers and subagents with graph memory.",
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
