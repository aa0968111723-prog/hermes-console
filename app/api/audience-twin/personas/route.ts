import { NextResponse } from "next/server";
import { AUDIENCE_DISCLAIMER } from "@/lib/server/audience.ts";
import {
  PERSONAS,
  resolvePersonasForContext,
} from "@/lib/server/audience-twin/engine.ts";

export async function GET(): Promise<NextResponse>;
export async function GET(req: Request): Promise<NextResponse>;
export async function GET(req?: Request): Promise<NextResponse> {
  const url = req?.url ? new URL(req.url) : null;
  const domainParam =
    url?.searchParams.get("domain") || url?.searchParams.get("projectId") || "";

  let personas = PERSONAS;
  let domain = "tamkang";

  if (domainParam) {
    const resolved = resolvePersonasForContext("", domainParam);
    personas = resolved.personas;
    domain = resolved.domain;
  }

  return NextResponse.json({
    ok: true,
    domain,
    count: personas.length,
    personas,
    sourceKind: "console_fixture",
    simulation: true,
    method: "ai_heuristic",
    disclaimer: AUDIENCE_DISCLAIMER,
  });
}

