import { NextRequest } from "next/server";
import { executeHermesTool } from "@/lib/tools";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, args } = body;
    if (!name) {
      return Response.json({ error: "缺少工具名稱" }, { status: 400 });
    }
    const result = await executeHermesTool(name, args || {});
    return Response.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
