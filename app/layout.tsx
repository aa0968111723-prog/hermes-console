import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes Console — 柯能中央大腦控制台",
  description: "深度連接 Zeabur Hermes Agent 伺服器，柯能生態系 41 專案對話與工具中樞"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
