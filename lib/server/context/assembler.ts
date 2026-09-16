import type { BudgetMode, Conversation } from "../../contracts";
import { memoriesForContext, isStaleMemory } from "../memory";
import { listInspiration, type InspirationItem } from "../inspiration";
import { listMaterials } from "../materials";
import { searchResearchNotes } from "../research-notes";
import { listArtifacts } from "../artifacts";
import { listWorkflows } from "../workflows";
import { estimateTokens, recencyScore, type ContextItem } from "./provenance";
import { relevanceTo } from "./ranking";
import { fitBudget } from "./budget";
import { wrapUntrusted } from "../untrusted";

function item(
  partial: Omit<ContextItem, "tokens"> & { tokens?: number },
): ContextItem {
  const tokens = partial.tokens || estimateTokens(partial.content);
  return { ...partial, tokens };
}

export function assembleContext(input: {
  owner: string;
  projectId: string;
  conversation?: Conversation;
  goalText: string;
  budgetMode?: BudgetMode;
}) {
  const query = input.goalText;
  const items: ContextItem[] = [];
  items.push(
    item({
      id: "goal",
      source: "goal",
      title: "目前目標",
      content: input.goalText.slice(0, 800),
      recency: 1,
      importance: 1,
      relevance: 1,
      confidence: 1,
      truth: "USER_PROVIDED",
    }),
  );
  items.push(
    item({
      id: "project",
      source: "project",
      title: "專案",
      content: "projectId=" + input.projectId,
      recency: 0.7,
      importance: 0.8,
      relevance: 0.8,
      confidence: 1,
      truth: "FACT",
    }),
  );
  for (const memory of memoriesForContext(input.owner, input.projectId, {
    conversationId: input.conversation?.id,
  })) {
    const stale = isStaleMemory(memory);
    const stored =
      typeof memory.confidence === "number" ? memory.confidence : 0.7;
    const text = memory.title + " " + memory.content;
    items.push(
      item({
        id: memory.id,
        source: "shared_memory",
        title: memory.title,
        content:
          (stale ? "可能過期，不得當成最新事實。 " : "") +
          memory.content.slice(0, 400),
        recency: recencyScore(memory.updatedAt),
        importance:
          typeof memory.importance === "number"
            ? memory.importance
            : memory.kind === "preference"
              ? 0.85
              : 0.6,
        relevance: relevanceTo(text, query),
        confidence: stale ? Math.min(0.35, stored) : stored,
        truth: "USER_PROVIDED",
        layer: memory.layer,
        stale,
      }),
    );
  }
  for (const message of (input.conversation?.messages || []).slice(-6)) {
    items.push(
      item({
        id: message.id,
        source: "conversation",
        title:
          message.role === "user"
            ? "使用者"
            : message.provenance === "workspace"
              ? "工作區"
              : "Hermes",
        content: message.content.slice(0, 400),
        recency: recencyScore(message.createdAt),
        importance: 0.45,
        relevance: relevanceTo(message.content, query),
        confidence:
          message.provenance === "hermes"
            ? 0.7
            : message.provenance === "workspace"
              ? 0.5
              : 0.4,
        truth: message.role === "user" ? "USER_PROVIDED" : "INFERENCE",
      }),
    );
  }
  for (const material of listMaterials(input.owner, {
    projectId: input.projectId,
  }).slice(0, 12)) {
    items.push(
      item({
        id: material.id,
        source: "material",
        title: material.title,
        content: (material.notes || material.title).slice(0, 240),
        recency: recencyScore(material.createdAt),
        importance: 0.5,
        relevance: relevanceTo(material.title + " " + (material.notes || ""), query),
        confidence: 0.6,
        truth: material.rights === "user_provided" ? "USER_PROVIDED" : "UNKNOWN",
      }),
    );
  }
  for (const inspiration of listInspiration(input.projectId).slice(0, 12) as InspirationItem[]) {
    items.push(
      item({
        id: inspiration.id,
        source: "inspiration",
        title: inspiration.account || inspiration.platform,
        content: (inspiration.captionExcerpt || inspiration.sourceUrl).slice(0, 240),
        recency: recencyScore(inspiration.collectedAt),
        importance: 0.4,
        relevance: relevanceTo(
          (inspiration.captionExcerpt || "") + " " + inspiration.sourceUrl,
          query,
        ),
        confidence: 0.5,
        truth: "USER_PROVIDED",
      }),
    );
  }
  for (const note of searchResearchNotes(query, 3)) {
    items.push(
      item({
        id: note.id,
        source: "research_notes",
        title: note.title,
        content:
          note.finding +
          "（本地研究筆記，不是即時論文庫；source=" +
          note.source +
          "）",
        recency: recencyScore(note.updatedAt),
        importance: 0.28,
        relevance: relevanceTo(note.title + " " + note.finding, query),
        confidence: 0.35,
        truth: "UNKNOWN",
      }),
    );
  }
  for (const artifact of listArtifacts(input.owner, input.projectId)
    .filter((row) => row.source === "copy")
    .slice(0, 8)) {
    const text = (artifact.title || "") + " " + (artifact.excerpt || "");
    items.push(
      item({
        id: artifact.artifactId,
        source: "artifact",
        title: (artifact.title || "作品") + " V" + artifact.revision,
        content:
          "沿用同一作品修改，不要另做無關新作。artifactId=" +
          artifact.artifactId +
          " revision=" +
          artifact.revision +
          (artifact.excerpt ? " " + artifact.excerpt : ""),
        recency: recencyScore(artifact.createdAt),
        importance: 0.78,
        relevance: relevanceTo(text, query),
        confidence: 0.9,
        truth: "FACT",
      }),
    );
  }
  for (const workflow of listWorkflows(input.owner)
    .filter((row) => row.projectId === input.projectId)
    .slice(0, 6)) {
    const picked =
      workflow.selected != null
        ? workflow.directions[workflow.selected]
        : null;
    const text =
      workflow.brief + " " + (picked?.title || "") + " " + (picked?.copy || "");
    items.push(
      item({
        id: workflow.id,
        source: "creative_direction",
        title: (picked?.title || workflow.brief || "創作方向").slice(0, 80),
        content:
          (workflow.selected == null
            ? "尚未選擇方向。"
            : "已選方向 " + (workflow.selected + 1) + "。") +
          (workflow.design
            ? "已有設計預覽，沿用同一 workflow 修改。"
            : "尚無設計預覽。") +
          " workflowId=" +
          workflow.id +
          " state=" +
          workflow.state,
        recency: recencyScore(workflow.updatedAt),
        importance: 0.72,
        relevance: relevanceTo(text, query),
        confidence: workflow.design ? 0.85 : 0.6,
        truth: "USER_PROVIDED",
      }),
    );
  }
  const packed = fitBudget(items, input.budgetMode || "balanced");
  return packed;
}

export function formatContextForInstructions(packed: ReturnType<typeof assembleContext>) {
  if (!packed.items.length) return "目前沒有可納入的專案上下文。";
  const lines = packed.items.map((entry) => {
    const body = wrapUntrusted(
      entry.source,
      entry.content.replace(/\s+/g, " ").slice(0, 220),
    );
    const flags: string[] = [entry.source, entry.truth];
    if (entry.layer) flags.push(entry.layer);
    if (entry.stale) flags.push("STALE");
    if (entry.confidence < 0.45) flags.push("LOW_CONFIDENCE");
    return `- [${flags.join("/")}] ${entry.title}：\n${body}`;
  });
  return [
    "已依相關性／新近／重要度與 token budget 挑選的上下文（" +
      packed.used +
      "/" +
      packed.limit +
      "）。STALE 不得當成最新事實。",
    lines.join("\n"),
  ].join("\n");
}
