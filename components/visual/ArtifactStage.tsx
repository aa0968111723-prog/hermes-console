"use client";

import { Layers, MessageSquare } from "lucide-react";
import CanvaResult from "../CanvaResult";

export default function ArtifactStage({
  design,
  onContinue,
}: {
  design: Record<string, unknown>;
  onContinue?: () => void;
}) {
  return (
    <section className="artifact-stage" aria-label="設計成果預覽">
      <header>
        <span>
          <Layers size={16} />
          成果
        </span>
        {onContinue && (
          <button
            className="icon-button"
            aria-label="在對話修改這個作品"
            onClick={onContinue}
          >
            <MessageSquare size={18} />
          </button>
        )}
      </header>
      <CanvaResult design={design} />
    </section>
  );
}
