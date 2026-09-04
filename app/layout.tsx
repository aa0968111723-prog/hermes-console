import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "倒的創作小天地",
  description: "倒與 Hermes 的手機創作聊天桌",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
