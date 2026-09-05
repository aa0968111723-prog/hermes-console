import { NextResponse } from "next/server";
import { PERSONAS } from "@/lib/server/audience-twin/engine.ts";

export async function GET() {
  return NextResponse.json({ ok: true, count: PERSONAS.length, personas: PERSONAS });
}
