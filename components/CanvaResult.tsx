"use client";
import { ExternalLink } from "lucide-react";
function canvaURL(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com")) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export default function CanvaResult({
  design,
}: {
  design: Record<string, unknown>;
}) {
  const urls = design.urls as
    | { edit_url?: string; view_url?: string }
    | undefined;
  const thumbnail = design.thumbnail as { url?: string } | undefined;
  const edit = canvaURL(design.url) || canvaURL(urls?.edit_url);
  const image = canvaURL(thumbnail?.url);
  return (
    <article className="canva-result">
      {image && (
        <img
          src={image}
          alt="Canva 回傳的設計預覽"
          referrerPolicy="no-referrer"
        />
      )}
      <h3>{typeof design.title === "string" ? design.title : "Canva 草稿"}</h3>
      {edit ? (
        <a
          className="button-link"
          href={edit}
          target="_blank"
          rel="noopener noreferrer"
        >
          開啟 Canva 繼續編輯 <ExternalLink size={16} />
        </a>
      ) : (
        <p>Canva 尚未提供可驗證的編輯連結，請查回製作結果。</p>
      )}
    </article>
  );
}
