import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  publicMcpAddress,
  resolveMcpTarget,
  safeMcpFetch,
} from "../lib/server/mcp-network";

test("MCP blocks private, metadata, mapped IPv6, mixed DNS answers and unsafe URLs", async () => {
  for (const address of [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2002:a00:1::",
  ])
    assert.equal(publicMcpAddress(address), false, address);
  assert.equal(publicMcpAddress("8.8.8.8"), true);
  assert.equal(publicMcpAddress("2606:4700:4700::1111"), true);
  await assert.rejects(
    resolveMcpTarget(new URL("https://mcp.example"), async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
    /私網/,
  );
  for (const url of [
    "file:///etc/passwd",
    "https://user:password@example.com",
    "https://example.com/?token=test",
  ])
    await assert.rejects(resolveMcpTarget(new URL(url)), /HTTPS/);
});
test("explicit loopback fixture transport works, with redirects rejected before credential forwarding", async () => {
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url === "/redirect")
      res.writeHead(302, { Location: "/credential-sink" }).end();
    else res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    await assert.rejects(safeMcpFetch(base, { signal: AbortSignal.abort() }));
    assert.equal(requests, 0, "aborted discovery must not open a socket");
    assert.equal(await (await safeMcpFetch(base)).text(), "ok");
    await assert.rejects(safeMcpFetch(base + "/redirect"), /redirect blocked/);
    assert.equal(requests, 2);
    process.env.HERMES_ALLOW_LOOPBACK_HTTP = "false";
    await assert.rejects(safeMcpFetch(base), /HTTPS/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
