import type { BudgetMode, Conversation } from "../../contracts";
import { list } from "../store";
import { listMemories } from "../memory";
import { listInspiration, type InspirationItem } from "../inspiration";
import type { Material } from "../../contracts";
import { estimateTokens, recencyScore, type ContextItem } from "./provenance";
import { relevanceTo } from "./ranking";
import { fitBudget } from "./budget";

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
  for (const memory of listMemories(input.owner, input.projectId).slice(0, 20)) {
    const text = memory.title + " " + memory.content;
    items.push(
      item({
        id: memory.id,
        source: "shared_memory",
        title: memory.title,
        content: memory.content.slice(0, 400),
        recency: recencyScore(memory.updatedAt),
        importance: memory.kind === "preference" ? 0.85 : 0.6,
        relevance: relevanceTo(text, query),
        confidence: 0.7,
        truth: "USER_PROVIDED",
      }),
    );
  }
  for (const message of (input.conversation?.messages || []).slice(-6)) {
    items.push(
      item({
        id: message.id,
        source: "conversation",
        title: message.role === "user" ? "使用者" : "Hermes",
        content: message.content.slice(0, 400),
        recency: recencyScore(message.createdAt),
        importance: 0.45,
        relevance: relevanceTo(message.content, query),
        confidence: message.provenance === "hermes" ? 0.7 : 0.4,
        truth: message.role === "user" ? "USER_PROVIDED" : "INFERENCE",
      }),
    );
  }
  for (const material of list<Material>("material", input.owner)
    .filter((entry) => entry.projectId === input.projectId)
    .slice(0, 12)) {
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
  const packed = fitBudget(items, input.budgetMode || "balanced");
  return packed;
}

export function formatContextForInstructions(packed: ReturnType<typeof assembleContext>) {
  if (!packed.items.length) return "目前沒有可納入的專案上下文。";
  const lines = packed.items.map((entry) => {
    return `- [${entry.source}/${entry.truth}] ${entry.title}：${entry.content.replace(/\s+/g, " ").slice(0, 220)}`;
  });
  return [
    "已依相關性／新近／重要度與 token budget 挑選的上下文（" +
      packed.used +
      "/" +
      packed.limit +
      "）：",
    lines.join("\n"),
  ].join("\n");
}
