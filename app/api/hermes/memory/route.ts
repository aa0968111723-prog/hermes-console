import { NextRequest, NextResponse } from "next/server";
import { searchMemories, listMemories, addMemory } from "@/lib/server/hermes";
import { verifySameOrigin } from "@/lib/server/security";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const project = url.searchParams.get("project") || undefined;

  const memories = q ? searchMemories(q, project) : listMemories(project);
  return NextResponse.json({ ok: true, count: memories.length, memories });
}

export async function POST(req: NextRequest) {
  const originCheck = verifySameOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.reason }, { status: 403 });
  }

  try {
    const body = await req.json();
    if (!body.title || !body.content) {
      return NextResponse.json({ error: "標題與內容為必填" }, { status: 400 });
    }
    const created = addMemory({
      type: body.type || "insight",
      project: body.project || "tku-zen-agent",
      title: body.title,
      content: body.content,
      evidenceType: body.evidenceType || "campus_observation",
      tags: Array.isArray(body.tags) ? body.tags : []
    });
    return NextResponse.json({ ok: true, memory: created });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
