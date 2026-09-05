import { NextResponse } from "next/server";
import { AUDIENCE_DISCLAIMER } from "@/lib/server/audience.ts";
import { PERSONAS } from "@/lib/server/audience-twin/engine.ts";

export async function GET() {
  return NextResponse.json({
    ok: true,
    count: PERSONAS.length,
    personas: PERSONAS,
    sourceKind: "console_fixture",
    simulation: true,
    method: "ai_heuristic",
    disclaimer: AUDIENCE_DISCLAIMER,
  });
}
