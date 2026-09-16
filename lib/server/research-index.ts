import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type ResearchNode = {
  id: string;
  title: string;
  source: string;
  finding: string;
  confidence: null;
  updatedAt: string;
};

function heading(markdown: string, fallback: string) {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return (match?.[1] || fallback).trim().slice(0, 120);
}

function excerpt(markdown: string) {
  return markdown
    .replace(/^#.*$/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/** Local docs only. Not a live web crawl, and not shown on the home chat. */
export function listResearchNodes(limit = 12): ResearchNode[] {
  const root = join(process.cwd(), "docs");
  let files: string[] = [];
  try {
    files = readdirSync(root)
      .filter((name) => name.endsWith(".md"))
      .slice(0, 40);
  } catch {
    return [];
  }
  return files
    .map((name) => {
      const source = join("docs", name);
      try {
        const path = join(root, name);
        const markdown = readFileSync(path, "utf8");
        const updatedAt = statSync(path).mtime.toISOString();
        return {
          id: name.replace(/\.md$/, ""),
          title: heading(markdown, name),
          source,
          finding: excerpt(markdown),
          confidence: null,
          updatedAt,
        } satisfies ResearchNode;
      } catch {
        return null;
      }
    })
    .filter((row): row is ResearchNode => !!row)
    .slice(0, limit);
}

export function researchDigest(limit = 8) {
  const nodes = listResearchNodes(limit);
  if (!nodes.length) return "";
  return (
    "\n工作區研究文件索引（本機 docs，不是即時網路搜尋；confidence 未評分）：\n" +
    nodes
      .map(
        (node) =>
          `- [${node.source}] ${node.title}：${node.finding || "（無摘要）"}`,
      )
      .join("\n")
  );
}
