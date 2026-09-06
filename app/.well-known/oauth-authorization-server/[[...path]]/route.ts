import { respond, route } from "@/lib/server/security";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const consoleOrigin = process.env.CONSOLE_ORIGIN;
  const baseUrl = consoleOrigin ? new URL(consoleOrigin).origin : new URL(req.url).origin;
  return respond({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/auth`,
    token_endpoint: `${baseUrl}/api/auth`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    service_documentation: `${baseUrl}/docs/GEMINI-SPARK.md`,
  });
});
