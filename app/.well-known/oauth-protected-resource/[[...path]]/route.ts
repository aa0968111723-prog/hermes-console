import { respond, route } from "@/lib/server/security";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const consoleOrigin = process.env.CONSOLE_ORIGIN;
  const baseUrl = consoleOrigin ? new URL(consoleOrigin).origin : new URL(req.url).origin;
  return respond({
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ["inspiration:read", "inspiration:write", "mcp:tools"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${baseUrl}/api/mcp-registry`,
  });
});
