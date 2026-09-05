import { NextResponse } from "next/server";
import { getMcpServers, MCP_SERVERS } from "@/lib/server/mcp/registry.ts";

export async function GET() {
  const servers = getMcpServers ? getMcpServers() : MCP_SERVERS;
  return NextResponse.json({ ok: true, servers });
}
