import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@xyflow/react/dist/style.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Checkfu",
  description: "Personalized, printable K–1 learning materials.",
  themeColor: "#ffffff",
  manifest: "/favicon/site.webmanifest",
  openGraph: {
    title: "Checkfu",
    description: "Personalized, printable K–1 learning materials.",
    siteName: "Checkfu",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/product.png",
        width: 1200,
        height: 630,
        alt: "Checkfu editor preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Checkfu",
    description: "Personalized, printable K–1 learning materials.",
    images: ["/product.png"],
  },
  icons: {
    icon: [
      { url: "/favicon/favicon.ico" },
      { url: "/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/favicon/apple-touch-icon.png",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClerkProvider dynamic>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
