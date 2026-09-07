"use client";

import { Layers, MoreHorizontal } from "lucide-react";
import CanvaResult from "../CanvaResult";

export default function ArtifactStage({ design }: { design: Record<string, unknown> }) {
  const title = typeof design.title === "string" ? design.title : "設計成果";
  return <section className="artifact-stage" aria-label="設計成果預覽">
    <header><span><Layers size={16} />成果</span><button className="icon-button" aria-label="更多成果動作"><MoreHorizontal size={18} /></button></header>
    <CanvaResult design={design} />
    <p className="artifact-caption">{title} · 實際工具回傳</p>
  </section>;
}
