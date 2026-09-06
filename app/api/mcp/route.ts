import { z } from "zod";
import { bridgeAuth, callTool, toolsList } from "@/lib/server/mcp";
import { jsonBody, respond, route } from "@/lib/server/security";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  bridgeAuth(req);
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
});
export const POST = route(async (req) => {
  const owner = bridgeAuth(req);
  const version = req.headers.get("mcp-protocol-version");
  if (version && !["2025-03-26", "2025-06-18"].includes(version))
    return respond({ error: "Unsupported protocol version" }, 400);
  const accept = req.headers.get("accept") || "";
  if (
    !accept.includes("application/json") ||
    !accept.includes("text/event-stream")
  )
    return respond(
      { error: "Accept must include application/json and text/event-stream" },
      406,
    );
  const parsed = z
    .object({
      jsonrpc: z.literal("2.0"),
      id: z.union([z.string(), z.number()]).optional(),
      method: z.string(),
      params: z.unknown().optional(),
    })
    .safeParse(await jsonBody(req, 150_000));
  if (!parsed.success)
    return respond(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      },
      400,
    );
  const message = parsed.data;
  if (message.id === undefined) return new Response(null, { status: 202 });
  const result = (value: unknown) =>
    respond({ jsonrpc: "2.0", id: message.id, result: value });
  if (message.method === "initialize")
    return result({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "hermes-console-workspace", version: "1.0.0" },
    });
  if (message.method === "ping") return result({});
  if (message.method === "tools/list")
    return result({ tools: toolsList(owner) });
  if (message.method === "tools/call") {
    const args = z
      .object({ name: z.string(), arguments: z.unknown().optional() })
      .safeParse(message.params);
    if (!args.success)
      return respond({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: "Invalid params" },
      });
    try {
      return result(
        await callTool(
          owner,
          args.data.name,
          args.data.arguments || {},
          message.id,
        ),
      );
    } catch {
      return respond({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32602,
          message: "Tool unavailable or invalid arguments",
        },
      });
    }
  }
  return respond({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found" },
  });
});
