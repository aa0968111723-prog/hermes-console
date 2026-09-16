import { loadCatalog, loadGraph } from "./catalog";
import { needsZenclubKnowledge } from "./detect";
import { entitiesForWindow, happeningOn, relativeWindow, taipeiDay } from "./timeline";
import type {
  KnowledgeConflict,
  KnowledgeEntity,
  KnowledgeSearchResult,
} from "./types";

const NOTICE =
  "工作區 Drive 快照，不是即時讀檔，也不是 Instagram。缺的欄位會留空，不補寫。";

const EVENT_KEYS = [
  "茶會",
  "社博",
  "期初演講",
  "期初茶會",
  "入社",
  "社課",
  "挑戰營",
  "擺攤",
  "招生",
  "禪學社",
  "淡大",
  "淡江",
  "生命靈數",
  "皇帝殿",
  "文館左側",
  "網宣",
  "浮花禪光",
  "讀書不卡關",
];

function haystack(entity: KnowledgeEntity) {
  return [
    entity.title,
    ...entity.aliases,
    entity.year || "",
    entity.semester || "",
    entity.kind,
    ...entity.claims.map(
      (claim) =>
        `${claim.field} ${claim.value || ""} ${claim.status} ${claim.note || ""}`,
    ),
  ]
    .join("\n")
    .toLowerCase();
}

function whitespaceTokens(query: string) {
  return query
    .toLowerCase()
    .split(/[\s,，。！？、；;:：/\\|()\-【】\[\]]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function queryKeys(query: string) {
  const needle = query.toLowerCase();
  return EVENT_KEYS.filter((key) => needle.includes(key.toLowerCase()));
}

function relatedConflicts(entityIds: string[], all: KnowledgeConflict[]) {
  return all.filter((conflict) =>
    conflict.entityIds.some((id) => entityIds.includes(id)),
  );
}

function unknownsFrom(entities: KnowledgeEntity[]) {
  const items = new Set<string>();
  for (const entity of entities) {
    for (const claim of entity.claims) {
      if (claim.status === "UNKNOWN" || claim.value == null) {
        items.add(`${entity.title} · ${claim.field}：UNKNOWN`);
      }
    }
  }
  return [...items];
}

export function formatKnowledgeForHermes(
  query: string,
  hits: KnowledgeEntity[],
  conflicts: KnowledgeConflict[],
): KnowledgeSearchResult["forHermes"] {
  const snapshotAt = loadGraph().snapshotAt;
  return {
    snapshotAt,
    live: false,
    hits: hits.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      title: entity.title,
      year: entity.year,
      semester: entity.semester,
      claims: entity.claims.map((claim) => ({
        field: claim.field,
        value: claim.value,
        status: claim.status,
        sourceTitle: claim.sources[0]?.title || null,
        sourceUrl: claim.sources[0]?.url || null,
      })),
    })),
    conflicts: conflicts.map((conflict) => ({
      field: conflict.field,
      values: conflict.values,
      note: conflict.note,
    })),
    unknowns: unknownsFrom(hits),
    notice: NOTICE,
  };
}

export function currentSemesterEntities() {
  return loadGraph().entities.filter((entity) => entity.semester === "115-1");
}

function scoreEntity(
  entity: KnowledgeEntity,
  query: string,
  now: Date,
): { score: number; matched: string[] } {
  const text = haystack(entity);
  const needle = query.trim().toLowerCase();
  const matched: string[] = [];
  let score = 0;
  if (!needle) {
    if (entity.semester === "115-1") {
      score = 3;
      matched.push("current_semester");
    }
    if (happeningOn(taipeiDay(now)).some((item) => item.id === entity.id)) {
      score += 8;
      matched.push("today");
    }
    return { score, matched };
  }
  const window = relativeWindow(needle);
  if (window) {
    const timed = new Set(entitiesForWindow(window, now).map((item) => item.id));
    if (timed.has(entity.id)) {
      score += 10;
      matched.push(window);
    }
  }
  if (text.includes(needle)) {
    score += 8;
    matched.push(query.trim());
  }
  for (const label of [entity.title, ...entity.aliases]) {
    const value = label.toLowerCase();
    if (value.length >= 2 && (needle.includes(value) || value.includes(needle))) {
      score += 6;
      matched.push(label);
    }
  }
  for (const key of queryKeys(needle)) {
    if (!text.includes(key.toLowerCase())) continue;
    const inTitle = [entity.title, ...entity.aliases].some((label) =>
      label.toLowerCase().includes(key.toLowerCase()),
    );
    score += inTitle ? 8 : 3;
    matched.push(key);
  }
  for (const token of whitespaceTokens(needle)) {
    if (text.includes(token)) {
      score += entity.title.toLowerCase().includes(token) ? 4 : 2;
      matched.push(token);
    }
  }
  if (!/114/.test(needle) && entity.semester === "115-1") score += 3;
  if (!/114/.test(needle) && entity.semester?.startsWith("114")) score -= 1;
  if (/宣傳|海報|網宣|做一張|靈感/.test(needle)) {
    if (entity.kind === "activity") score += 6;
    if (entity.kind === "form") score -= 5;
  }
  return { score, matched: [...new Set(matched)] };
}

export function searchZenclubKnowledge(
  query: string,
  now = new Date(),
): KnowledgeSearchResult {
  const graph = loadGraph();
  const catalog = loadCatalog();
  const trimmed = query.trim();
  const redacted = catalog.files.filter((file) => file.piiRestricted).length;
  const scored = graph.entities
    .map((entity) => {
      const { score, matched } = scoreEntity(entity, trimmed, now);
      return { entity, score, matched };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id))
    .slice(0, 12);

  const hits = scored;
  const entityIds = hits.map((item) => item.entity.id);
  const conflicts = relatedConflicts(entityIds, graph.conflicts);
  const entities = hits.map((item) => item.entity);
  const unknowns = unknownsFrom(entities);
  if (trimmed && hits.length === 0) {
    unknowns.push("查無對應 Drive 索引，標 UNKNOWN，不得用外部靈感補事實。");
  }

  return {
    query: trimmed,
    live: false,
    snapshotAt: graph.snapshotAt,
    method: "indexed_snapshot",
    hits,
    conflicts,
    unknowns,
    redacted,
    notice: NOTICE,
    forHermes: formatKnowledgeForHermes(trimmed, entities, conflicts),
  };
}

export function knowledgeContextForPrompt(prompt: string) {
  if (!needsZenclubKnowledge(prompt)) return null;
  return searchZenclubKnowledge(prompt);
}

export { needsZenclubKnowledge };
