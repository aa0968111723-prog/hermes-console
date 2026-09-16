import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import "./mobile-spatial.css";

export const metadata: Metadata = {
  title: "Hermes Creative Intelligence",
  description: "與 Hermes 一起，把活動想法整理成有來源、可接續的創作。",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAFCF8",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body>
        <Script id="hermes-reset-hash" strategy="beforeInteractive">
          {`(function(){try{var m=/(?:^|#|&)reset=([a-f0-9]{64})/.exec(location.hash);if(m)sessionStorage.setItem("hermes_reset_token",m[1]);}catch(e){}})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
