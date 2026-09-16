import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { relevanceTo } from "./context/ranking";

export type ResearchNode = {
  id: string;
  title: string;
  source: string;
  finding: string;
  confidence: "local_notes";
  updatedAt: string;
  relation: "repo_research_note";
};

const DIR = join(process.cwd(), "data", "ai-agent-research");
const MIN_RELEVANCE = 0.45;

let cache: { nodes: ResearchNode[]; loadedAt: number } | null = null;

function excerpt(text: string) {
  const section = text.split(/##\s*本小時新發現/)[1];
  const body = (section || text)
    .replace(/^#.*$/m, "")
    .replace(/\[.*?\]\(.*?\)/g, " ")
    .replace(/[`#*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return body.slice(0, 420);
}

function parseNote(file: string, text: string): ResearchNode {
  const title =
    text.match(/^#\s+(.+)$/m)?.[1]?.replace(/【|】/g, "").trim() || file;
  const day = file.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return {
    id: file.replace(/\.md$/i, ""),
    title: title.slice(0, 160),
    source: "data/ai-agent-research/" + file,
    finding: excerpt(text),
    confidence: "local_notes",
    updatedAt: day ? day + "T00:00:00.000Z" : new Date(0).toISOString(),
    relation: "repo_research_note",
  };
}

export function listResearchNodes(): ResearchNode[] {
  const now = Date.now();
  if (cache && now - cache.loadedAt < 60_000) return cache.nodes;
  let files: string[] = [];
  try {
    files = readdirSync(DIR).filter((name) => name.endsWith(".md"));
  } catch {
    cache = { nodes: [], loadedAt: now };
    return cache.nodes;
  }
  const nodes = files.map((file) => {
    const path = join(DIR, file);
    try {
      statSync(path);
      return parseNote(file, readFileSync(path, "utf8").slice(0, 8_000));
    } catch {
      return parseNote(file, "");
    }
  });
  cache = { nodes, loadedAt: now };
  return nodes;
}

export function searchResearchNotes(query: string, limit = 5): ResearchNode[] {
  const q = query.trim();
  if (q.length < 2) return [];
  return listResearchNodes()
    .map((node) => ({
      node,
      score: relevanceTo(node.title + " " + node.finding, q),
    }))
    .filter((row) => row.score >= MIN_RELEVANCE)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 8)))
    .map((row) => row.node);
}
