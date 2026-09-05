import { NextResponse } from "next/server";
import { listAgentProfiles } from "@/lib/server/hermes";

export async function GET() {
  const profiles = listAgentProfiles();
  return NextResponse.json({ ok: true, profiles });
}
