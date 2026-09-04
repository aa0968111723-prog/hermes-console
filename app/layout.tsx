import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "倞的創作小天地",
  description: "倞與 Hermes 的手機創作聊天桌"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
