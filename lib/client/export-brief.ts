import type { Workflow } from "../server/workflows";

function text(value: string) {
  return value.replace(/[\\`*_\[\]<>]/g, character => "\\" + character);
}

// Export persisted content only. No generated dates, school facts, scores or Canva links.
export function generateCreativeStrategyMarkdown(workflow: Workflow, index: number): string {
  const direction = workflow.directions[index];
  if (!Number.isInteger(index) || !direction) throw new Error("找不到指定創作方向。");
  return [
    "# " + text(direction.title), "",
    "流程：" + workflow.id, "專案：" + workflow.projectId,
    "方向：" + (index + 1), "選定狀態：" + (workflow.selected === index ? "已選定" : "未選定"),
    "資料更新時間：" + workflow.updatedAt, "",
    "> 匯出的是已保存草稿，不代表來源已查證、Canva 已完成、內容已發佈或受眾成效已實測。",
    "", "## 活動需求", text(workflow.brief), "",
    "## 核心主張", text(direction.claim), "",
    "## 視覺方向", text(direction.visual), "",
    "## 文案", text(direction.copy), "",
    "## 行動呼籲", text(direction.cta), "",
    "## 來源（保留原始網址；未在匯出時重新擷取）",
    ...direction.sources.map(source => "- " + text(source)),
    ...(direction.sources.length ? [] : ["尚未提供來源。"]),
    "", "## 待確認與風險", ...(direction.risks?.map(risk => "- " + text(risk)) ?? ["未提供風險檢核；不能視為全部已確認。"]),
    "",
  ].join("\n");
}
