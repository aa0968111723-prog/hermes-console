import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes Console",
  description: "柏能 / Bruce 的 Hermes Agent 駐駛艙"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
