import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "الفرات موبايل | متجر الهواتف والإكسسوارات",
  description: "الفرات موبايل في صنعاء، شميلة مول غزة. هواتف وإكسسوارات ومنتجات تقنية.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
