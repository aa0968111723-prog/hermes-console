import { loadCatalog, loadGraph } from "./catalog";
import { needsZenclubKnowledge } from "./detect";
import type {
  KnowledgeConflict,
  KnowledgeEntity,
  KnowledgeSearchResult,
} from "./types";

const NOTICE =
  "這是禪學社 Drive 索引快照，不是即時讀檔，也不是 IG。缺資料標 UNKNOWN，不得補寫。通訊錄與報名回覆已排除。";

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

function tokens(query: string) {
  return query
    .toLowerCase()
    .split(/[\s,，。！？、；;:：/\\|()\-【】\[\]]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
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

export function searchZenclubKnowledge(query: string): KnowledgeSearchResult {
  const graph = loadGraph();
  const catalog = loadCatalog();
  const trimmed = query.trim();
  const redacted = catalog.files.filter((file) => file.piiRestricted).length;
  const scored = graph.entities
    .map((entity) => {
      const text = haystack(entity);
      const matched: string[] = [];
      let score = 0;
      if (!trimmed) {
        if (entity.semester === "115-1") {
          score = 3;
          matched.push("current_semester");
        }
      } else {
        const needle = trimmed.toLowerCase();
        if (text.includes(needle)) {
          score += 8;
          matched.push(trimmed);
        }
        for (const label of [entity.title, ...entity.aliases]) {
          const value = label.toLowerCase();
          if (value.length >= 2 && (needle.includes(value) || value.includes(needle))) {
            score += 6;
            matched.push(label);
          }
        }
        for (const token of tokens(trimmed)) {
          if (text.includes(token)) {
            score += entity.title.toLowerCase().includes(token) ? 4 : 2;
            matched.push(token);
          }
        }
      }
      return { entity, score, matched: [...new Set(matched)] };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
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
