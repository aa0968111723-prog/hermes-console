import { NextResponse } from "next/server";
import { listAgentProfiles } from "@/lib/server/hermes/registry";

export async function GET() {
  const profiles = listAgentProfiles();
  return NextResponse.json({
    ok: true,
    profiles,
    note: "These are Console roles, not live Hermes /p/<profile> discovery. Named Hermes profiles require env URL/key references.",
  });
}
