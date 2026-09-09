import type { Task, TaskEvent } from "../contracts";

/** Planform-iso metres. 1 unit = 1 m. Coordinates are x / z (yaw about +Y). */
export type PlanformPoint = { x: number; z: number };

export type PlanformArea = {
  id: string;
  name: string;
  x: number;
  z: number;
  length: number;
  width: number;
};

export type PlanformObject = {
  id: string;
  kind: string;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotationDeg: number;
};

export type PlanformZone = {
  id: string;
  name: string;
  type: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  color: string | null;
};

export type PlanformRoute = {
  id: string;
  name: string;
  type: string;
  points: PlanformPoint[];
  color: string | null;
};

export type PlanformCandidate = {
  id: string;
  label: string;
  recommended: boolean;
  score: number | null;
  layout: PlanformScene;
};

export type PlanformScene = {
  areas: PlanformArea[];
  objects: PlanformObject[];
  zones: PlanformZone[];
  routes: PlanformRoute[];
};

export type PlanformLayout = PlanformScene & {
  hasGeometry: boolean;
  name: string | null;
  previewActive: boolean | null;
  applied: boolean | null;
  unresolved: string[];
  issues: string[];
  candidates: PlanformCandidate[];
  selectedId: string | null;
};

const KIND_LABELS: Record<string, string> = {
  table: "桌子",
  chair: "椅子",
  mat: "地墊",
  regTable: "報到桌",
  door: "門",
  screen: "投影",
  computer: "電腦",
  switch: "開關",
  sign: "立牌",
  shelf: "展示架",
  box: "箱子",
  tent: "帳篷",
  banner: "布條",
  plant: "盆栽",
  lamp: "燈",
  light: "燈",
  qr: "QR",
  teapot: "茶具",
  tea: "茶具",
  poster: "海報",
  flyer: "DM",
  dm: "DM",
  "service-desk": "服務桌",
};

const ZONE_LABELS: Record<string, string> = {
  registration: "報到",
  payment: "收費",
  life: "生活組",
  group: "小組",
  meditation: "靜坐",
  shoe: "鞋子",
  backpack: "背包",
  custom: "區域",
};

const ROUTE_LABELS: Record<string, string> = {
  entry: "入場",
  registration: "報到動線",
  payment: "收費動線",
  shoe: "鞋子動線",
  backpack: "背包動線",
  seating: "入座",
  group: "小組動線",
  staff: "工作動線",
  visitor: "訪客動線",
  custom: "動線",
};

const NEST_KEYS = [
  "result",
  "project",
  "summary",
  "layout",
  "data",
  "preview",
  "scene",
  "venue",
  "structuredContent",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown, max = 500): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  return n;
}

function text(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function idOf(value: Record<string, unknown>, fallback: string): string {
  return (
    text(value.id, 120) ||
    text(value.objectId, 120) ||
    text(value.zoneId, 120) ||
    text(value.routeId, 120) ||
    fallback
  );
}

export function planformKindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind;
}

export function planformZoneLabel(type: string, name?: string | null): string {
  return name || ZONE_LABELS[type] || type;
}

export function planformRouteLabel(type: string, name?: string | null): string {
  return name || ROUTE_LABELS[type] || type;
}

function envelopes(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!isRecord(value) || depth > 6) return [];
  const found = [value];
  for (const key of NEST_KEYS) {
    if (isRecord(value[key])) found.push(...envelopes(value[key], depth + 1));
  }
  return found;
}

function parseArea(
  value: unknown,
  fallbackId: string,
  fallbackName: string,
): PlanformArea | null {
  if (!isRecord(value)) return null;
  const length =
    finite(value.length) ?? finite(value.widthX) ?? finite(value.sizeX);
  const width =
    finite(value.width) ?? finite(value.depth) ?? finite(value.sizeZ);
  if (length == null || width == null || length <= 0 || width <= 0) return null;
  return {
    id: idOf(value, fallbackId),
    name: text(value.name) || fallbackName,
    x: finite(value.x) ?? 0,
    z: finite(value.z) ?? finite(value.y) ?? 0,
    length,
    width,
  };
}

function parseObject(
  value: unknown,
  index: number,
): PlanformObject | null {
  if (!isRecord(value) || value.hidden === true) return null;
  const x = finite(value.x);
  const z = finite(value.z) ?? (value.x !== undefined ? finite(value.y) : null);
  const width = finite(value.width) ?? finite(value.w) ?? finite(value.sizeX);
  const depth = finite(value.depth) ?? finite(value.d) ?? finite(value.sizeZ);
  if (x == null || z == null || width == null || depth == null) return null;
  if (width <= 0 || depth <= 0) return null;
  const kind = text(value.kind, 40) || text(value.semanticType, 40) || "other";
  const label =
    text(value.label) ||
    text(value.name) ||
    text(value.displayName) ||
    planformKindLabel(kind);
  return {
    id: idOf(value, "object-" + index),
    kind,
    label,
    x,
    z,
    width,
    depth,
    height: Math.max(0, finite(value.height) ?? 0),
    rotationDeg: finite(value.rotationDeg, 360) ?? 0,
  };
}

function parseGroup(value: unknown, index: number): PlanformObject | null {
  if (!isRecord(value) || value.hidden === true) return null;
  const rows = finite(value.rows, 100);
  const cols = finite(value.cols, 100);
  const itemW = finite(value.itemWidth) ?? finite(value.width);
  const itemD = finite(value.itemDepth) ?? finite(value.depth);
  const gapX = finite(value.gapX) ?? 0;
  const gapZ = finite(value.gapZ) ?? 0;
  const anchorX = finite(value.anchorX) ?? finite(value.x);
  const anchorZ = finite(value.anchorZ) ?? finite(value.z);
  if (
    rows == null ||
    cols == null ||
    itemW == null ||
    itemD == null ||
    anchorX == null ||
    anchorZ == null
  )
    return null;
  if (rows < 1 || cols < 1 || itemW <= 0 || itemD <= 0) return null;
  const width = cols * itemW + Math.max(0, cols - 1) * gapX;
  const depth = rows * itemD + Math.max(0, rows - 1) * gapZ;
  const kind = text(value.sourceKind, 40) || "mat";
  const count = Math.round(rows * cols);
  return {
    id: idOf(value, "group-" + index),
    kind,
    label:
      (text(value.name) || planformKindLabel(kind) + "陣列") + " ×" + count,
    x: anchorX + width / 2,
    z: anchorZ + depth / 2,
    width,
    depth,
    height: Math.max(0, finite(value.itemHeight) ?? 0),
    rotationDeg: finite(value.rotationDeg, 360) ?? 0,
  };
}

function parseZone(value: unknown, index: number): PlanformZone | null {
  if (!isRecord(value) || value.hidden === true) return null;
  const x = finite(value.x);
  const z = finite(value.z) ?? (value.x !== undefined ? finite(value.y) : null);
  const width = finite(value.width);
  const depth = finite(value.depth);
  if (x == null || z == null || width == null || depth == null) return null;
  if (width <= 0 || depth <= 0) return null;
  const type = text(value.type, 40) || "custom";
  return {
    id: idOf(value, "zone-" + index),
    name: planformZoneLabel(type, text(value.name)),
    type,
    x,
    z,
    width,
    depth,
    color: text(value.color, 20),
  };
}

function parsePoint(value: unknown): PlanformPoint | null {
  if (!isRecord(value)) return null;
  const x = finite(value.x);
  const z = finite(value.z) ?? finite(value.y);
  if (x == null || z == null) return null;
  return { x, z };
}

function parseRoute(value: unknown, index: number): PlanformRoute | null {
  if (!isRecord(value) || value.visible === false) return null;
  const raw = Array.isArray(value.points) ? value.points : [];
  const points = raw
    .map(parsePoint)
    .filter((p): p is PlanformPoint => !!p);
  if (points.length < 2) return null;
  const type = text(value.type, 40) || text(value.boothRole, 40) || "custom";
  return {
    id: idOf(value, "route-" + index),
    name: planformRouteLabel(type, text(value.name)),
    type,
    points,
    color: text(value.color, 20),
  };
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sceneFrom(record: Record<string, unknown>): PlanformScene {
  const areas: PlanformArea[] = [];
  const classroom = parseArea(record.classroom, "classroom", "教室");
  const corridor = parseArea(record.corridor, "corridor", "走廊");
  if (classroom) areas.push(classroom);
  if (corridor) areas.push(corridor);
  const venue = parseArea(record.venue, "venue", text(record.venueName) || "場地");
  if (venue && !areas.length) areas.push(venue);
  for (const [i, room] of list(record.rooms).entries()) {
    const parsed = parseArea(room, "room-" + i, "場地");
    if (parsed) areas.push(parsed);
  }
  const objects = [
    ...list(record.objects).map(parseObject),
    ...list(record.items).map(parseObject),
    ...list(record.placements).map(parseObject),
    ...list(record.groups).map(parseGroup),
  ].filter((item): item is PlanformObject => !!item);
  const zones = list(record.zones)
    .map(parseZone)
    .filter((item): item is PlanformZone => !!item);
  const routes = list(record.routes)
    .map(parseRoute)
    .filter((item): item is PlanformRoute => !!item);
  return { areas, objects, zones, routes };
}

function hasGeometry(scene: PlanformScene): boolean {
  return !!(
    scene.areas.length ||
    scene.objects.length ||
    scene.zones.length ||
    scene.routes.length
  );
}

function mergeScene(base: PlanformScene, extra: PlanformScene): PlanformScene {
  const take = <T extends { id: string }>(a: T[], b: T[]) => {
    const map = new Map(a.map((item) => [item.id, item]));
    for (const item of b) map.set(item.id, item);
    return [...map.values()];
  };
  return {
    areas: take(base.areas, extra.areas),
    objects: take(base.objects, extra.objects),
    zones: take(base.zones, extra.zones),
    routes: take(base.routes, extra.routes),
  };
}

function unresolvedOf(record: Record<string, unknown>): string[] {
  return list(record.unresolved)
    .map((item) =>
      typeof item === "string"
        ? item
        : isRecord(item)
          ? text(item.name) || text(item.id) || text(item.query)
          : null,
    )
    .filter((item): item is string => !!item)
    .slice(0, 20);
}

function issuesOf(record: Record<string, unknown>): string[] {
  const raw = [
    ...list(record.issues),
    ...list(record.warnings),
    ...list(record.errors),
    ...list(isRecord(record.validation) ? record.validation.issues : []),
  ];
  return raw
    .map((item) =>
      typeof item === "string"
        ? item
        : isRecord(item)
          ? text(item.message, 200) || text(item.summary, 200)
          : null,
    )
    .filter((item): item is string => !!item)
    .slice(0, 20);
}

function parseCandidate(
  value: unknown,
  index: number,
  recommendedId: string | null,
): PlanformCandidate | null {
  if (!isRecord(value)) return null;
  const scene = sceneFrom(value);
  const nested = isRecord(value.layout)
    ? sceneFrom(value.layout)
    : isRecord(value.project)
      ? sceneFrom(value.project)
      : { areas: [], objects: [], zones: [], routes: [] };
  const layout = mergeScene(scene, nested);
  if (!hasGeometry(layout)) return null;
  const id = text(value.id, 40) || text(value.candidateId, 40) || String.fromCharCode(65 + index);
  return {
    id,
    label: text(value.label) || text(value.name) || "方案 " + id,
    recommended: value.recommended === true || id === recommendedId,
    score: finite(value.score, 100),
    layout,
  };
}

function emptyLayout(): PlanformLayout {
  return {
    hasGeometry: false,
    name: null,
    previewActive: null,
    applied: null,
    unresolved: [],
    issues: [],
    candidates: [],
    selectedId: null,
    areas: [],
    objects: [],
    zones: [],
    routes: [],
  };
}

export function parsePlanformLayout(value: unknown): PlanformLayout | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const records = envelopes(value);
  if (!records.length && isRecord(value)) records.push(value);
  if (!records.length) return null;

  let scene: PlanformScene = {
    areas: [],
    objects: [],
    zones: [],
    routes: [],
  };
  let name: string | null = null;
  let previewActive: boolean | null = null;
  let applied: boolean | null = null;
  const unresolved: string[] = [];
  const issues: string[] = [];
  const candidates: PlanformCandidate[] = [];
  let recommendedId: string | null = null;

  for (const record of records) {
    name = name || text(record.name) || text(record.title) || text(record.projectName);
    const nextPreview = bool(record.previewActive);
    if (nextPreview != null) previewActive = nextPreview;
    const nextApplied = bool(record.applied);
    if (nextApplied != null) applied = nextApplied;
    unresolved.push(...unresolvedOf(record));
    issues.push(...issuesOf(record));
    recommendedId =
      recommendedId ||
      text(record.recommendedId, 40) ||
      text(record.recommended, 40);
    scene = mergeScene(scene, sceneFrom(record));
    const rawCandidates = [
      ...list(record.candidates),
      ...list(record.schemes),
      ...list(record.options),
    ];
    for (const [i, item] of rawCandidates.entries()) {
      const parsed = parseCandidate(item, i, recommendedId);
      if (parsed) candidates.push(parsed);
    }
  }

  const selected =
    candidates.find((item) => item.recommended) || candidates[0] || null;
  if (selected && !hasGeometry(scene)) scene = selected.layout;

  const uniqueUnresolved = [...new Set(unresolved)];
  const uniqueIssues = [...new Set(issues)];
  const layout: PlanformLayout = {
    ...scene,
    hasGeometry: hasGeometry(scene),
    name,
    previewActive,
    applied,
    unresolved: uniqueUnresolved,
    issues: uniqueIssues,
    candidates,
    selectedId: selected?.id || null,
  };
  if (
    !layout.hasGeometry &&
    previewActive == null &&
    applied == null &&
    !uniqueUnresolved.length &&
    !uniqueIssues.length &&
    !candidates.length &&
    !name
  )
    return null;
  return layout;
}

export function selectPlanformCandidate(
  layout: PlanformLayout,
  candidateId: string,
): PlanformLayout {
  const candidate = layout.candidates.find((item) => item.id === candidateId);
  if (!candidate) return layout;
  return {
    ...layout,
    ...candidate.layout,
    hasGeometry: hasGeometry(candidate.layout),
    selectedId: candidate.id,
    candidates: layout.candidates,
    name: layout.name,
    previewActive: layout.previewActive,
    applied: layout.applied,
    unresolved: layout.unresolved,
    issues: layout.issues,
  };
}

function isPlanformEvent(event: TaskEvent): boolean {
  return !!event.toolName && /planform/i.test(event.toolName);
}

export function layoutFromTask(task?: Task | null): PlanformLayout | null {
  if (!task) return null;
  let found: PlanformLayout | null = null;
  const status = emptyLayout();
  for (const event of task.events) {
    if (!isPlanformEvent(event)) continue;
    const parsed = parsePlanformLayout(event.result);
    if (!parsed) continue;
    if (parsed.previewActive != null) status.previewActive = parsed.previewActive;
    if (parsed.applied != null) status.applied = parsed.applied;
    status.unresolved = parsed.unresolved.length
      ? parsed.unresolved
      : status.unresolved;
    status.issues = parsed.issues.length ? parsed.issues : status.issues;
    status.name = parsed.name || status.name;
    if (parsed.hasGeometry || parsed.candidates.length) found = parsed;
  }
  if (!found && status.previewActive == null && status.applied == null && !status.unresolved.length)
    return null;
  if (!found) return { ...status, hasGeometry: false };
  return {
    ...found,
    previewActive:
      status.previewActive != null ? status.previewActive : found.previewActive,
    applied: status.applied != null ? status.applied : found.applied,
    unresolved: status.unresolved.length ? status.unresolved : found.unresolved,
    issues: status.issues.length ? status.issues : found.issues,
    name: status.name || found.name,
  };
}

export type PlanformView = "top" | "iso";

export type PlanformMark = {
  id: string;
  kind: "area" | "zone" | "object" | "route";
  label: string;
  fill: string;
  d: string;
  points?: string;
  polygons?: string[];
};

export type PlanformFrame = {
  viewBox: string;
  widthM: number;
  depthM: number;
  marks: PlanformMark[];
};

function bounds(layout: PlanformScene): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const add = (x: number, z: number) => {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  };
  for (const area of layout.areas) {
    add(area.x, area.z);
    add(area.x + area.length, area.z + area.width);
  }
  for (const item of [...layout.objects, ...layout.zones]) {
    add(item.x - item.width / 2, item.z - item.depth / 2);
    add(item.x + item.width / 2, item.z + item.depth / 2);
  }
  for (const route of layout.routes)
    for (const point of route.points) add(point.x, point.z);
  if (!Number.isFinite(minX)) return { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
  const pad = 0.4;
  return {
    minX: minX - pad,
    minZ: minZ - pad,
    maxX: maxX + pad,
    maxZ: maxZ + pad,
  };
}

function objectFill(kind: string): string {
  if (/door/i.test(kind)) return "#c45b3a";
  if (/mat/i.test(kind)) return "#e6d7a2";
  if (/chair/i.test(kind)) return "#7ea37a";
  if (/regTable|service-desk|table/i.test(kind)) return "#c9a27a";
  if (/screen|computer/i.test(kind)) return "#4a5d54";
  if (/sign|poster|banner/i.test(kind)) return "#356b45";
  if (/shelf|tent/i.test(kind)) return "#8b6b4a";
  if (/plant/i.test(kind)) return "#5d8a4a";
  if (/lamp|light/i.test(kind)) return "#d4b85a";
  if (/qr|dm|flyer/i.test(kind)) return "#3d6b8a";
  if (/tea/i.test(kind)) return "#8a5a3d";
  return "#8a958c";
}

function poly(points: PlanformPoint[]): string {
  return points.map((p) => p.x.toFixed(3) + "," + p.z.toFixed(3)).join(" ");
}

function rectPoints(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  rotationDeg: number,
): PlanformPoint[] {
  const hw = width / 2;
  const hd = depth / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: PlanformPoint[] = [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ];
  return corners.map((c) => ({
    x: cx + c.x * cos - c.z * sin,
    z: cz + c.x * sin + c.z * cos,
  }));
}

function isoPoint(x: number, z: number, y = 0): PlanformPoint {
  return {
    x: (x - z) * 0.866,
    z: (x + z) * 0.5 - y,
  };
}

function isoBox(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  height: number,
  rotationDeg: number,
): string[] {
  const base = rectPoints(cx, cz, width, depth, rotationDeg).map((p) =>
    isoPoint(p.x, p.z, 0),
  );
  const top = rectPoints(cx, cz, width, depth, rotationDeg).map((p) =>
    isoPoint(p.x, p.z, height),
  );
  if (height <= 0) return [poly(top)];
  return [
    poly([base[2], base[3], top[3], top[2]]),
    poly([base[1], base[2], top[2], top[1]]),
    poly(top),
  ];
}

export function planformFrame(
  layout: PlanformScene,
  view: PlanformView,
): PlanformFrame {
  const box = bounds(layout);
  const marks: PlanformMark[] = [];
  if (view === "top") {
    for (const area of layout.areas) {
      marks.push({
        id: area.id,
        kind: "area",
        label: area.name,
        fill: area.id === "corridor" ? "#eef3e8" : "#f7fbf4",
        d: "",
        points: poly([
          { x: area.x, z: area.z },
          { x: area.x + area.length, z: area.z },
          { x: area.x + area.length, z: area.z + area.width },
          { x: area.x, z: area.z + area.width },
        ]),
      });
    }
    for (const zone of layout.zones) {
      marks.push({
        id: zone.id,
        kind: "zone",
        label: zone.name,
        fill: zone.color || "rgba(53,107,69,0.16)",
        d: "",
        points: poly(rectPoints(zone.x, zone.z, zone.width, zone.depth, 0)),
      });
    }
    for (const object of layout.objects) {
      marks.push({
        id: object.id,
        kind: "object",
        label: object.label,
        fill: objectFill(object.kind),
        d: "",
        points: poly(
          rectPoints(
            object.x,
            object.z,
            object.width,
            object.depth,
            object.rotationDeg,
          ),
        ),
      });
    }
    for (const route of layout.routes) {
      marks.push({
        id: route.id,
        kind: "route",
        label: route.name,
        fill: route.color || "#c45b3a",
        d: route.points
          .map((p, i) => (i ? "L" : "M") + p.x.toFixed(3) + " " + p.z.toFixed(3))
          .join(" "),
      });
    }
    return {
      viewBox: [
        box.minX,
        box.minZ,
        box.maxX - box.minX,
        box.maxZ - box.minZ,
      ]
        .map((n) => n.toFixed(3))
        .join(" "),
      widthM: box.maxX - box.minX,
      depthM: box.maxZ - box.minZ,
      marks,
    };
  }

  const isoMarks: PlanformMark[] = [];
  const isoPts: PlanformPoint[] = [];
  const remember = (pts: PlanformPoint[]) => {
    isoPts.push(...pts);
    return pts;
  };
  for (const area of layout.areas) {
    const pts = remember(
      [
        { x: area.x, z: area.z },
        { x: area.x + area.length, z: area.z },
        { x: area.x + area.length, z: area.z + area.width },
        { x: area.x, z: area.z + area.width },
      ].map((p) => isoPoint(p.x, p.z)),
    );
    isoMarks.push({
      id: area.id,
      kind: "area",
      label: area.name,
      fill: area.id === "corridor" ? "#e4ecdc" : "#eef6ea",
      d: "",
      points: poly(pts),
    });
  }
  for (const zone of layout.zones) {
    const pts = remember(
      rectPoints(zone.x, zone.z, zone.width, zone.depth, 0).map((p) =>
        isoPoint(p.x, p.z),
      ),
    );
    isoMarks.push({
      id: zone.id,
      kind: "zone",
      label: zone.name,
      fill: zone.color || "rgba(53,107,69,0.2)",
      d: "",
      points: poly(pts),
    });
  }
  for (const object of layout.objects) {
    const h = object.height || 0;
    const base = rectPoints(
      object.x,
      object.z,
      object.width,
      object.depth,
      object.rotationDeg,
    );
    remember(base.map((p) => isoPoint(p.x, p.z, h)));
    remember(base.map((p) => isoPoint(p.x, p.z, 0)));
    isoMarks.push({
      id: object.id,
      kind: "object",
      label: object.label,
      fill: objectFill(object.kind),
      d: "",
      polygons: isoBox(
        object.x,
        object.z,
        object.width,
        object.depth,
        h,
        object.rotationDeg,
      ),
      points: poly(base.map((p) => isoPoint(p.x, p.z, h))),
    });
  }
  for (const route of layout.routes) {
    const pts = remember(route.points.map((p) => isoPoint(p.x, p.z, 0.02)));
    isoMarks.push({
      id: route.id,
      kind: "route",
      label: route.name,
      fill: route.color || "#c45b3a",
      d: pts
        .map((p, i) => (i ? "L" : "M") + p.x.toFixed(3) + " " + p.z.toFixed(3))
        .join(" "),
    });
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of isoPts) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minZ = 0;
    maxX = 1;
    maxZ = 1;
  }
  const pad = 0.35;
  return {
    viewBox: [
      minX - pad,
      minZ - pad,
      maxX - minX + pad * 2,
      maxZ - minZ + pad * 2,
    ]
      .map((n) => n.toFixed(3))
      .join(" "),
    widthM: box.maxX - box.minX,
    depthM: box.maxZ - box.minZ,
    marks: isoMarks,
  };
}

export function objectCounts(layout: PlanformScene): { label: string; count: number }[] {
  const map = new Map<string, number>();
  for (const object of layout.objects) {
    const label = planformKindLabel(object.kind);
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count }));
}
