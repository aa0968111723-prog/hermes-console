"use client";

import { ScanSearch } from "lucide-react";
import type { TwinPanel } from "@/lib/server/audience/types";
import {
  critiqueDirections,
  critiqueFollowUp,
  critiqueLayers,
  type ImageReadView,
} from "@/lib/client/image-critique";
import MaterialThumb from "./MaterialThumb";

export default function ImageCritiqueResult({
  read,
  panel,
  onOpen,
  onUseDirection,
}: {
  read: ImageReadView;
  panel?: TwinPanel | null;
  onOpen?: () => void;
  onUseDirection?: (prompt: string) => void;
}) {
  const layers = critiqueLayers(read, panel);
  const directions = critiqueDirections(panel);
  return (
    <section className="image-critique" aria-label="畫面分析">
      <p className="eyebrow">畫面 · 已讀取</p>
      <button
        type="button"
        className="critique-poster"
        onClick={onOpen}
        disabled={!onOpen}
        aria-label={read.title ? "預覽 " + read.title : "預覽上傳畫面"}
      >
        <MaterialThumb
          material={{
            id: read.materialId,
            kind: "image",
            mime: read.mime || "image/png",
            url: null,
            title: read.title || "上傳畫面",
          }}
          alt={read.title || "上傳畫面"}
          variant="thumb"
        />
      </button>
      <h2>{read.title || "上傳畫面"}</h2>
      <ul className="critique-layers" aria-label="視覺層級">
        {layers.map((layer) => (
          <li key={layer.id} data-state={layer.state}>
            <ScanSearch size={14} aria-hidden="true" />
            <span>{layer.label}</span>
            <small>{layer.state}</small>
          </li>
        ))}
      </ul>
      {directions.length > 0 && (
        <ul className="critique-directions" aria-label="修改方向（模擬）">
          {directions.map((direction) => (
            <li key={direction}>
              <p>{direction}</p>
              {onUseDirection && (
                <button
                  type="button"
                  onClick={() => onUseDirection(critiqueFollowUp(direction))}
                >
                  依這個改
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="quiet">{read.notice}</p>
    </section>
  );
}
