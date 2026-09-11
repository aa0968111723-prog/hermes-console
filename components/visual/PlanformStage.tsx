"use client";

import { useId, useMemo, useState } from "react";
import { Map, Boxes, Route, BoxSelect } from "lucide-react";
import type { Task } from "@/lib/contracts";
import {
  layoutFromTask,
  objectCounts,
  planformFrame,
  selectPlanformCandidate,
  type PlanformLayout,
  type PlanformView,
} from "@/lib/client/planform-layout";
import styles from "./PlanformStage.module.css";

type Tab = PlanformView | "list" | "flow";

const TABS: { id: Tab; label: string; icon: typeof Map }[] = [
  { id: "top", label: "俯視", icon: Map },
  { id: "iso", label: "等角", icon: BoxSelect },
  { id: "list", label: "物件", icon: Boxes },
  { id: "flow", label: "動線", icon: Route },
];

function statusLine(layout: PlanformLayout): string {
  if (layout.applied) return "已套用正式專案";
  if (layout.previewActive) return "草稿預覽 · 尚未套用";
  if (layout.unresolved.length) return "有找不到的物件，沒有猜放";
  return "Planform 回傳的場佈";
}

function PlanformCanvas({
  layout,
  view,
}: {
  layout: PlanformLayout;
  view: PlanformView;
}) {
  const frame = useMemo(() => planformFrame(layout, view), [layout, view]);
  const arrowId = useId().replace(/:/g, "");
  return (
    <svg
      className={styles.canvas}
      viewBox={frame.viewBox}
      role="img"
      aria-label={view === "top" ? "場佈俯視圖" : "場佈等角圖"}
      preserveAspectRatio="xMidYMid meet"
    >
      {frame.marks.map((mark) => {
        if (mark.kind === "route")
          return (
            <path
              key={mark.id}
              d={mark.d}
              fill="none"
              stroke={mark.fill}
              strokeWidth={view === "top" ? 0.12 : 0.08}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={`url(#${arrowId})`}
            />
          );
        if (mark.kind === "scale")
          return (
            <g key={mark.id}>
              <path
                d={mark.d}
                fill="none"
                stroke={mark.fill}
                strokeWidth={0.06}
                strokeLinecap="square"
              />
              <text
                x={mark.x}
                y={mark.z}
                fill={mark.fill}
                fontSize={0.28}
                textAnchor="middle"
              >
                {mark.text}
              </text>
            </g>
          );
        if (mark.kind === "label" && mark.text)
          return (
            <g key={mark.id}>
              {/^\d+$/.test(mark.text) && (
                <circle
                  cx={mark.x}
                  cy={mark.z}
                  r={0.18}
                  fill="#fff"
                  stroke={mark.fill}
                  strokeWidth={0.04}
                />
              )}
              <text
                x={mark.x}
                y={mark.z}
                dy={0.08}
                fill={/^\d+$/.test(mark.text) ? mark.fill : "#26332b"}
                fontSize={/^\d+$/.test(mark.text) ? 0.22 : 0.26}
                textAnchor="middle"
              >
                {mark.text}
              </text>
            </g>
          );
        if (mark.polygons?.length) {
          const faces = mark.polygons;
          return (
            <g key={mark.id}>
              {faces.map((points, i) => (
                <polygon
                  key={mark.id + "-" + i}
                  points={points}
                  fill={mark.fill}
                  fillOpacity={i === faces.length - 1 ? 0.95 : 0.7}
                  stroke="#26332b"
                  strokeWidth={0.03}
                />
              ))}
            </g>
          );
        }
        return (
          <polygon
            key={mark.id}
            points={mark.points}
            fill={mark.fill}
            stroke="#26332b"
            strokeWidth={mark.kind === "area" ? 0.06 : 0.04}
            fillOpacity={mark.kind === "zone" ? 0.35 : 0.92}
          />
        );
      })}
      <defs>
        <marker
          id={arrowId}
          markerWidth="4"
          markerHeight="4"
          refX="3"
          refY="2"
          orient="auto"
        >
          <path d="M0,0 L4,2 L0,4 Z" fill="#c45b3a" />
        </marker>
      </defs>
    </svg>
  );
}

export default function PlanformStage({
  task,
  layout: given,
}: {
  task?: Task;
  layout?: PlanformLayout | null;
}) {
  const parsed = given ?? layoutFromTask(task);
  const [tab, setTab] = useState<Tab>("top");
  const [candidateId, setCandidateId] = useState<string | null>(
    parsed?.selectedId || null,
  );
  if (!parsed) return null;
  const layout =
    candidateId && parsed.candidates.length
      ? selectPlanformCandidate(parsed, candidateId)
      : parsed;
  const counts = objectCounts(layout);
  const view: PlanformView = tab === "iso" ? "iso" : "top";
  return (
    <section className={styles.stage} data-testid="planform-stage" aria-label="場佈預覽">
      <header>
        <strong>{layout.name || "場佈"}</strong>
        <small>{statusLine(layout)}</small>
      </header>
      {!!layout.candidates.length && (
        <div className={styles.schemes} role="group" aria-label="場佈方案">
          {layout.candidates.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === layout.selectedId ? styles.isOn : undefined}
              aria-pressed={item.id === layout.selectedId}
              onClick={() => setCandidateId(item.id)}
            >
              {item.label}
              {item.recommended ? " · 推薦" : ""}
            </button>
          ))}
        </div>
      )}
      {layout.hasGeometry ? (
        <>
          <div className={styles.tabs} role="tablist" aria-label="場佈視圖">
            {TABS.map((item) => {
              const Icon = item.icon;
              const on = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={on ? styles.isOn : undefined}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </div>
          {tab === "list" ? (
            <ul className={styles.list}>
              {layout.objects.map((object) => (
                <li key={object.id}>
                  <b>{object.label}</b>
                  <small>
                    {object.width.toFixed(2)}×{object.depth.toFixed(2)} m · (
                    {object.x.toFixed(1)}, {object.z.toFixed(1)})
                  </small>
                </li>
              ))}
              {!layout.objects.length && <li>Planform 沒有回傳物件座標</li>}
            </ul>
          ) : tab === "flow" ? (
            <ol className={styles.flow}>
              {layout.routes.map((route) => (
                <li key={route.id}>
                  <b>{route.name}</b>
                  <small>{route.points.length} 個節點</small>
                </li>
              ))}
              {!layout.routes.length && (
                <li>Planform 沒有回傳動線，沒有畫假箭頭</li>
              )}
            </ol>
          ) : (
            <PlanformCanvas layout={layout} view={view} />
          )}
          {!!counts.length && tab !== "list" && (
            <ul className={styles.chips}>
              {counts.map((item) => (
                <li key={item.label}>
                  {item.label} {item.count}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className={styles.empty}>
          Planform 這次沒有回傳場地幾何，所以沒有畫平面圖。
        </p>
      )}
      {!!layout.unresolved.length && (
        <p className={styles.warn}>
          找不到：{layout.unresolved.join("、")}
        </p>
      )}
      {!!layout.issues.length && (
        <p className={styles.warn}>檢查：{layout.issues.join("、")}</p>
      )}
    </section>
  );
}
