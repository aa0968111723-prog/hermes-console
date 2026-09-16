import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type ResearchNode = {
  id: string;
  title: string;
  source: string;
  finding: string;
  confidence: "snapshot";
  updatedAt: string;
};

const DIR = join(process.cwd(), "data/ai-agent-research");
let cached: ResearchNode[] | null = null;
let cachedStamp = "";

function indexStamp() {
  if (!existsSync(DIR)) return "missing";
  const names = readdirSync(DIR).filter((name) => name.endsWith(".md"));
  let latest = 0;
  for (const name of names) {
    try {
      const time = statSync(join(DIR, name)).mtimeMs;
      if (time > latest) latest = time;
    } catch {
      /* unreadable notes stay out of the stamp */
    }
  }
  return names.length + ":" + latest;
}

function excerpt(text: string) {
  const block =
    text.match(/## 本小時新發現\s+([\s\S]*?)(?:\n## |\n### )/)?.[1] ||
    text.match(/## 本小時最重要[^\n]*\s+([\s\S]*?)(?:\n## )/)?.[1] ||
    text.replace(/^#.*\n/, "");
  return block.replace(/\s+/g, " ").trim().slice(0, 600);
}

function parseNote(filename: string, text: string): ResearchNode {
  const topic =
    text.match(/\*\*主題[：:]\s*([^*]+)\*\*/)?.[1]?.trim() ||
    text.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    filename.replace(/\.md$/, "");
  const date = filename.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return {
    id: filename.replace(/\.md$/, ""),
    title: topic.slice(0, 160),
    source: "ai-agent-research/" + filename,
    finding: excerpt(text),
    confidence: "snapshot",
    updatedAt: date ? date + "T00:00:00.000Z" : "",
  };
}

export function loadResearchIndex() {
  const stamp = indexStamp();
  if (cached && cachedStamp === stamp) return cached;
  if (!existsSync(DIR)) {
    cached = [];
    cachedStamp = stamp;
    return cached;
  }
  cached = readdirSync(DIR)
    .filter((name) => name.endsWith(".md"))
    .slice(0, 400)
    .flatMap((name) => {
      const path = join(DIR, name);
      try {
        if (statSync(path).size > 200_000) return [];
        return [parseNote(name, readFileSync(path, "utf8"))];
      } catch {
        return [];
      }
    });
  cachedStamp = stamp;
  return cached;
}

export function searchResearch(query: string, limit = 6) {
  const tokens = query
    .toLowerCase()
    .split(/[\s,，。！？、；;:：/\\|()\-【】\[\]]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const notice =
    "工作區研究筆記快照，不是即時文獻，也不是網宣靈感。沒有命中不得編造。";
  if (!tokens.length)
    return { nodes: [] as ResearchNode[], notice, total: loadResearchIndex().length };
  const scored = loadResearchIndex()
    .map((node) => {
      const hay = (node.title + " " + node.source + " " + node.finding).toLowerCase();
      return {
        node,
        score: tokens.reduce((sum, token) => sum + (hay.includes(token) ? 1 : 0), 0),
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.node.updatedAt.localeCompare(a.node.updatedAt),
    )
    .slice(0, Math.min(8, Math.max(1, limit)));
  return {
    nodes: scored.map((item) => item.node),
    notice,
    total: loadResearchIndex().length,
  };
}
