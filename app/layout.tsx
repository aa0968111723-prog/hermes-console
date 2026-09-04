import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "倢的創作小天地",
  description: "倢與柏能的創作小天地，大腦是 Hermes"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
