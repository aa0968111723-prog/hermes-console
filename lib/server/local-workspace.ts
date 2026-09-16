import { interpretGoal } from "./orchestrator/goal";
import { searchZenclubKnowledge, needsZenclubKnowledge } from "./zenclub";
import { searchInspiration } from "./inspiration/engine";

export function localWorkspaceReply(
  input: string,
  projectId = "personal",
): string | null {
  const text = input.trim();
  if (!needsZenclubKnowledge(text)) return null;
  const knowledge = searchZenclubKnowledge(text);
  const goal = interpretGoal(text);
  const lines = [
    "Hermes Agent 尚未連線，沒有上網搜尋，也沒有使用 GALLEY 或 Canva。",
    "以下是工作區已索引的禪學社資料（Drive 快照，不是即時讀檔）。",
    knowledge.notice,
  ];
  if (!knowledge.hits.length) {
    lines.push("索引沒有命中。缺資料標 UNKNOWN，不得自行補日期或地點。");
  }
  for (const hit of knowledge.hits.slice(0, 6)) {
    const heading = [hit.entity.title, hit.entity.semester]
      .filter(Boolean)
      .join(" · ");
    const claims = hit.entity.claims
      .slice(0, 8)
      .map(
        (claim) =>
          `- ${claim.field}：${claim.value ?? "UNKNOWN"}（${claim.status}）`,
      );
    lines.push(["### " + heading, ...claims].join("\n"));
  }
  if (knowledge.unknowns.length) {
    lines.push(
      ["### UNKNOWN", ...knowledge.unknowns.slice(0, 12).map((item) => "- " + item)].join(
        "\n",
      ),
    );
  }
  if (knowledge.conflicts.length) {
    lines.push(
      [
        "### 衝突",
        ...knowledge.conflicts
          .slice(0, 6)
          .map((item) => `- ${item.field}：${item.values.join("／")}（${item.note}）`),
      ].join("\n"),
    );
  }
  if (goal.requiresInspiration) {
    let notice =
      "未授權來源不會假裝已搜尋整個 Instagram 或 Pinterest。";
    const saved: string[] = [];
    try {
      const inspiration = searchInspiration({
        prompt: text,
        projectId,
      });
      notice = inspiration.notice;
      for (const item of inspiration.items.slice(0, 6)) {
        saved.push(
          `- ${item.account || item.platform}：${(item.captionExcerpt || item.sourceUrl).slice(0, 80)}`,
        );
      }
    } catch {
      saved.length = 0;
    }
    lines.push(
      [
        "### 靈感",
        notice,
        saved.length
          ? saved.join("\n")
          : "目前沒有已保存的參考素材。連上 Hermes 後才能用已授權來源繼續找。",
      ].join("\n"),
    );
  }
  if (goal.requiresDesign || goal.requiresAudienceEvaluation) {
    lines.push(
      "創作、Canva 與完整受眾模擬需要 Hermes 連線後才能繼續。受眾評估若出現，只是模擬，不是民調。",
    );
  }
  return lines.join("\n\n");
}
