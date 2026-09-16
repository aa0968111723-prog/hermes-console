import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type ResearchNode = {
  id: string;
  title: string;
  finding: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  confidence: number;
  relation: string[];
};

const ROOT = join(process.cwd(), "data/ai-agent-research");
const NOTICE =
  "結果來自 Console 倉庫研究筆記，confidence 0.4。不是外部已驗證文獻，也不得當成 Hermes 已具備該能力。";

let cache: { mtime: number; nodes: ResearchNode[] } | null = null;

function fileDate(name: string) {
  const match = name.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] + "T00:00:00+08:00" : "";
}

function loadNodes(): ResearchNode[] {
  let mtime = 0;
  try {
    mtime = statSync(ROOT).mtimeMs;
  } catch {
    return [];
  }
  if (cache && cache.mtime === mtime) return cache.nodes;
  const files = readdirSync(ROOT)
    .filter((name) => name.endsWith(".md"))
    .slice(0, 400);
  const nodes: ResearchNode[] = [];
  for (const file of files) {
    let text = "";
    try {
      text = readFileSync(join(ROOT, file), "utf8").slice(0, 8_000);
    } catch {
      continue;
    }
    const heading = text
      .match(/^#\s+(.+)$/m)?.[1]
      ?.replace(/[【】]/g, "")
      .trim();
    const finding = (
      text.match(/#+\s*1[^\n]*\n+([\s\S]{40,480})/)?.[1] || text.slice(0, 280)
    )
      .replace(/\s+/g, " ")
      .trim();
    const relation = [
      ...text.matchAll(/`(\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md)`/gi),
    ]
      .map((row) => row[1])
      .slice(0, 6);
    nodes.push({
      id: file.replace(/\.md$/, ""),
      title: (heading || file.replace(/\.md$/, "")).slice(0, 180),
      finding: finding.slice(0, 400),
      source: "data/ai-agent-research/" + file,
      createdAt: fileDate(file),
      updatedAt: fileDate(file),
      confidence: 0.4,
      relation,
    });
  }
  cache = { mtime, nodes };
  return nodes;
}

export function searchResearchNotes(query: string, limit = 5) {
  const q = query.trim().toLowerCase();
  if (q.length < 2)
    return { notice: "請提供關鍵字。" + NOTICE, nodes: [] as ResearchNode[] };
  const tokens = q.split(/[\s,，、/_-]+/).filter((token) => token.length > 1);
  const ranked = loadNodes()
    .map((node) => {
      const hay = (node.title + " " + node.finding + " " + node.id).toLowerCase();
      let score = 0;
      for (const token of tokens) if (hay.includes(token)) score += 1;
      if (hay.includes(q)) score += 2;
      return { node, score };
    })
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.node.createdAt.localeCompare(a.node.createdAt),
    );
  return {
    notice: NOTICE,
    nodes: ranked.slice(0, Math.min(8, Math.max(1, limit))).map((row) => row.node),
  };
}
