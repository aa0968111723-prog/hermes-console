import { NextResponse } from "next/server";
import { MCP_SERVERS } from "@/lib/server/mcp/registry.ts";

export async function GET() {
  return NextResponse.json({ ok: true, servers: MCP_SERVERS });
}
