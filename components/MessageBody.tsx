"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";
import { parseVisualConceptPack } from "@/lib/client/visual-pack";
import VisualConceptCards from "./visual/VisualConceptCards";
function safeURL(value: string) {
  if (value.startsWith("/api/materials?id=")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export default memo(function MessageBody({
  text,
  workflows,
  canvaReady,
  onChooseDirection,
}: {
  text: string;
  workflows?: Array<{ id: string; selected: number | null }>;
  canvaReady?: boolean;
  onChooseDirection?: (workflowId: string, index: number) => void;
}) {
  const pack = parseVisualConceptPack(text);
  if (pack) {
    const workflow = pack.workflowId
      ? workflows?.find((item) => item.id === pack.workflowId)
      : undefined;
    return (
      <VisualConceptCards
        pack={pack}
        selectedDirection={workflow?.selected ?? null}
        canvaReady={canvaReady}
        onChooseDirection={pack.workflowId ? onChooseDirection : undefined}
      />
    );
  }
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeURL}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <a
              className="image-source"
              href={typeof src === "string" ? src : undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看圖片：{alt || "來源圖片"} ↗
            </a>
          ),
          table: ({ children }) => (
            <div
              className="table-scroll"
              role="region"
              aria-label="表格，可水平捲動"
              tabIndex={0}
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
