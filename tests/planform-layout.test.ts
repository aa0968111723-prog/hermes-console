import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Task, TaskEvent } from "../lib/contracts";
import {
  layoutFromTask,
  objectCounts,
  parsePlanformLayout,
  planformFrame,
  planformKindLabel,
  selectPlanformCandidate,
} from "../lib/client/planform-layout";

const fixture = {
  name: "社課場佈 fixture",
  previewActive: true,
  classroom: { id: "classroom", name: "教室", length: 8, width: 6, x: 0, z: 0 },
  corridor: { id: "corridor", name: "走廊", length: 8, width: 2, x: 0, z: -2 },
  objects: [
    {
      id: "door-1",
      kind: "door",
      x: 4,
      z: 0.1,
      width: 1,
      depth: 0.1,
      height: 2.1,
      rotationDeg: 0,
    },
    {
      id: "table-1",
      kind: "regTable",
      label: "報到桌",
      x: 1.2,
      z: 1,
      width: 1.5,
      depth: 0.6,
      height: 0.75,
      rotationDeg: 0,
    },
    {
      id: "chair-1",
      kind: "chair",
      x: 1.2,
      z: 1.8,
      width: 0.45,
      depth: 0.45,
      height: 0.45,
      rotationDeg: 0,
    },
  ],
  groups: [
    {
      id: "mats",
      name: "地墊",
      sourceKind: "mat",
      rows: 4,
      cols: 5,
      itemWidth: 0.9,
      itemDepth: 0.6,
      gapX: 0.1,
      gapZ: 0.1,
      anchorX: 2.5,
      anchorZ: 2.2,
      itemHeight: 0.02,
    },
  ],
  zones: [
    {
      id: "checkin",
      type: "registration",
      name: "報到",
      x: 1.2,
      z: 1,
      width: 2,
      depth: 1.5,
    },
  ],
  routes: [
    {
      id: "entry",
      name: "入場",
      type: "entry",
      points: [
        { x: 4, z: -1 },
        { x: 4, z: 0.4 },
        { x: 1.2, z: 1 },
      ],
    },
  ],
  unresolved: [],
};

test("parses planform-iso project geometry without inventing missing rooms", () => {
  const layout = parsePlanformLayout(fixture);
  assert.ok(layout);
  assert.equal(layout?.hasGeometry, true);
  assert.equal(layout?.previewActive, true);
  assert.equal(layout?.areas.length, 2);
  assert.equal(layout?.objects.length, 4);
  assert.equal(layout?.zones[0]?.name, "報到");
  assert.equal(layout?.routes[0]?.points.length, 3);
  const mats = layout?.objects.find((item) => item.id === "mats");
  assert.ok(mats);
  assert.equal(mats?.width, 5 * 0.9 + 4 * 0.1);
  assert.equal(mats?.depth, 4 * 0.6 + 3 * 0.1);
  assert.equal(planformKindLabel("regTable"), "報到桌");
  assert.deepEqual(
    objectCounts(layout!).map((item) => item.label).sort(),
    ["地墊", "報到桌", "椅子", "門"],
  );
});

test("unwraps MCP / Workspace envelopes used by finishToolCall", () => {
  const nested = parsePlanformLayout({
    result: { project: fixture },
  });
  assert.equal(nested?.objects.length, 4);
  const asJson = parsePlanformLayout(JSON.stringify({ structuredContent: { result: fixture } }));
  assert.equal(asJson?.name, "社課場佈 fixture");
});

test("does not draw a floorplan from preview-only Planform status", () => {
  const layout = parsePlanformLayout({
    previewActive: true,
    unresolved: ["報到桌"],
    echo: "幫我把報到桌移到門口",
  });
  assert.ok(layout);
  assert.equal(layout?.hasGeometry, false);
  assert.equal(layout?.objects.length, 0);
  assert.deepEqual(layout?.unresolved, ["報到桌"]);
  assert.equal(parsePlanformLayout({ ok: true }), null);
  assert.equal(parsePlanformLayout("https://github.com/aa0968111723-prog/planform-iso"), null);
});

test("A/B/C candidates keep real geometry and do not invent a winner", () => {
  const layout = parsePlanformLayout({
    recommendedId: "B",
    candidates: [
      {
        id: "A",
        label: "方案 A",
        classroom: fixture.classroom,
        objects: [fixture.objects[1]],
      },
      {
        id: "B",
        label: "方案 B",
        classroom: fixture.classroom,
        objects: fixture.objects,
        score: 82,
      },
    ],
  });
  assert.equal(layout?.selectedId, "B");
  assert.equal(layout?.objects.length, 3);
  const a = selectPlanformCandidate(layout!, "A");
  assert.equal(a.selectedId, "A");
  assert.equal(a.objects.length, 1);
  assert.equal(a.objects[0]?.id, "table-1");
});

test("top view places objects from planform-iso centre coordinates", () => {
  const layout = parsePlanformLayout(fixture)!;
  const frame = planformFrame(layout, "top");
  const table = frame.marks.find((mark) => mark.id === "table-1");
  assert.ok(table?.points?.includes("0.450,0.700"));
  assert.ok(table?.points?.includes("1.950,1.300"));
  const iso = planformFrame(layout, "iso");
  assert.ok(iso.marks.some((mark) => mark.id === "table-1" && mark.polygons?.length));
  assert.ok(frame.marks.some((mark) => mark.kind === "route" && mark.d.startsWith("M")));
});

test("layoutFromTask keeps latest geometry and later confirm status", () => {
  const event = (id: string, name: string, result: unknown): TaskEvent =>
    ({
      id,
      taskId: "t1",
      toolName: name,
      status: "completed",
      startedAt: "2026-09-09T00:00:00.000Z",
      endedAt: "2026-09-09T00:00:01.000Z",
      summary: "ok",
      result,
      sources: [],
      error: null,
      usage: null,
    }) as TaskEvent;
  const task = {
    id: "t1",
    events: [
      event("1", "planform_run_agent", fixture),
      event("2", "planform_confirm_preview", { previewActive: false, applied: true }),
      event("3", "galley_research", { title: "not space" }),
    ],
  } as Task;
  const layout = layoutFromTask(task);
  assert.equal(layout?.hasGeometry, true);
  assert.equal(layout?.applied, true);
  assert.equal(layout?.previewActive, false);
  assert.equal(layoutFromTask({ id: "empty", events: [] } as unknown as Task), null);
});

test("VisualMessage mounts PlanformStage and never treats GitHub as MCP", async () => {
  const ui = await readFile(
    new URL("../components/visual/VisualMessage.tsx", import.meta.url),
    "utf8",
  );
  const stage = await readFile(
    new URL("../components/visual/PlanformStage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /PlanformStage/);
  assert.match(ui, /layoutFromTask/);
  const css = await readFile(
    new URL("../components/visual/PlanformStage.module.css", import.meta.url),
    "utf8",
  );
  assert.match(stage, /data-testid="planform-stage"/);
  assert.match(stage, /俯視/);
  assert.match(stage, /等角/);
  assert.match(stage, /物件/);
  assert.match(stage, /動線/);
  assert.match(stage, /PlanformStage\.module\.css/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(stage, /github\.com\/aa0968111723-prog\/planform-iso/);
  assert.doesNotMatch(css, /github\.com\/aa0968111723-prog\/planform-iso/);
  assert.doesNotMatch(ui, /github\.com\/aa0968111723-prog\/planform-iso/);
  assert.doesNotMatch(stage, /THREE|WebGL|webgl/);
});
