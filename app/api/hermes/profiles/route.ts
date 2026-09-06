import { NextResponse } from "next/server";
import { listAgentProfiles } from "@/lib/server/hermes/registry";
import { listHermesNamedProfiles } from "@/lib/server/hermes/target";

export async function GET() {
  const profiles = listAgentProfiles();
  const hermesProfiles = listHermesNamedProfiles();
  return NextResponse.json({
    ok: true,
    profiles,
    hermesProfiles,
    note: "Console roles are not live Hermes /p/<profile> discovery. Named Hermes profiles come from server env URL/key references.",
  });
}
