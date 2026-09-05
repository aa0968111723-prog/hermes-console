import { NextResponse } from "next/server";
import { MCP_TOOLS } from "@/lib/server/mcp/registry.ts";

export async function GET() {
  return NextResponse.json({ ok: true, count: MCP_TOOLS.length, tools: MCP_TOOLS });
}
