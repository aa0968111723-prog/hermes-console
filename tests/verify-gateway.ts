// Real Chromium -> isolated access-proxy fixture -> real production Console.
// The fixture models an already authenticated gateway session, NOT live SSO/Zeabur verification.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const data = await mkdtemp(join(tmpdir(), "hermes-gateway-browser-"));
const backendPort = Number(process.env.GATEWAY_TEST_PORT || 3371);
const backend = "http://127.0.0.1:" + backendPort;
const secret = randomBytes(32).toString("hex"),
  session = randomBytes(32).toString("hex");
const proxy = createServer(async (req, res) => {
  if (req.headers.cookie !== "gateway_fixture=" + session) {
    res.writeHead(401).end("Gateway session required (test fixture)");
    return;
  }
  if (!req.url?.startsWith("/") || req.url.startsWith("//")) {
    res.writeHead(400).end();
    return;
  }
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (
        value &&
        !["host", "connection", "content-length", "x-console-gateway"].includes(
          key,
        )
      )
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    headers.set("X-Console-Gateway", secret); // overwrite; never trust incoming assertion
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await fetch(backend + req.url, {
      method: req.method,
      headers,
      redirect: "manual",
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : Buffer.concat(chunks),
    });
    const outgoing = new Headers(response.headers);
    outgoing.delete("content-encoding");
    outgoing.delete("content-length");
    outgoing.delete("transfer-encoding");
    res.writeHead(response.status, Object.fromEntries(outgoing));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(502).end("Fixture upstream failed");
  }
});
await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + (proxy.address() as { port: number }).port;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-p",
    String(backendPort),
    "-H",
    "127.0.0.1",
  ],
  {
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_ORIGIN: origin,
      CONSOLE_DATA_DIR: data,
      CONSOLE_GATEWAY_SECRET: secret,
      CONSOLE_ALLOW_LOCAL_ACCESS: "false",
      HERMES_API_URL: "",
      HERMES_API_KEY: "",
      CANVA_CLIENT_ID: "",
      CANVA_CLIENT_SECRET: "",
      MCP_BRIDGE_TOKEN: "",
    },
  },
);
let logs = "";
child.stdout?.on("data", (chunk) => {
  logs += chunk;
});
child.stderr?.on("data", (chunk) => {
  logs += chunk;
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("Isolated Console exited");
    try {
      if ((await fetch(backend)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    (await fetch(backend + "/api/workspace", { headers: { Origin: origin } }))
      .status,
    401,
  );
  assert.equal(
    (
      await fetch(origin + "/api/workspace", {
        headers: { "X-Console-Gateway": "forged" },
      })
    ).status,
    401,
  );
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    { name: "gateway_fixture", value: session, url: origin },
  ]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) =>
    assert.ok(!JSON.stringify(request.headers()).includes(secret)),
  );
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "今天想做什麼？" }),
  ).toBeVisible();
  await expect(page.locator(".connection-pill")).toContainText("未設定");
  assert.equal(
    (await context.request.get(origin + "/api/workspace")).status(),
    200,
  );
  assert.equal(
    (
      await context.request.post(origin + "/api/workspace", {
        headers: { Origin: "https://attacker.example" },
        data: { name: "not-created" },
      })
    ).status(),
    403,
  );
  assert.ok(!(await page.content()).includes(secret));
  const output = resolve("output/playwright");
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: join(output, "gateway-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: join(output, "gateway-mobile-390.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.ok(!logs.includes(secret));
  console.log(
    "PASS: real browser -> access-proxy fixture -> real Console; no Console login, direct API denied, forged gateway denied, cross-origin write denied, gateway secret absent from browser requests/HTML/logs. NOT live SSO or Zeabur validation.",
  );
} finally {
  await browser?.close();
  child.kill();
  proxy.closeAllConnections();
  proxy.close();
}
