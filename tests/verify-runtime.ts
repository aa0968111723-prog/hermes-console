import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

// Production Console + real Chrome + isolated HTTP discovery fixture.
// The fixture declares tools; it never pretends to execute Hermes or Canva.
const dataDir = await mkdtemp(join(tmpdir(), "hermes-runtime-browser-"));
process.env.CONSOLE_DATA_DIR = dataDir;
const { saveDirections } = await import("../lib/server/workflows");
const workflow = saveDirections("workspace", {
  projectId: "personal",
  brief: "TEST ONLY 可選方向",
  directions: [1, 2, 3].map((n) => ({
    title: "測試方向 " + n,
    claim: "測試主張",
    visual: "待製作",
    copy: "測試文案",
    cta: "測試",
    sources: [],
  })),
});
let names = Array.from(
  { length: 300 },
  (_, n) => "fixture_tool_" + String(n).padStart(3, "0"),
);
let requests = 0;
const upstream = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    requests++;
    return void res.end(JSON.stringify({ data: [{ id: "fixture-only" }] }));
  }
  if (req.url === "/v1/capabilities")
    return void res.end(
      JSON.stringify({
        object: "hermes.api_server.capabilities",
        features: { run_submission: false },
      }),
    );
  if (req.url === "/v1/toolsets")
    return void res.end(
      JSON.stringify([
        {
          name: "test_only",
          description: "隔離測試清單，未執行外部工具",
          enabled: true,
          tools: names,
        },
      ]),
    );
  if (req.url === "/v1/skills") return void res.end("[]");
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const port = Number(process.env.RUNTIME_TEST_PORT || 3421),
  base = "http://127.0.0.1:" + port;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-p",
    String(port),
    "-H",
    "127.0.0.1",
  ],
  {
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_ORIGIN: base,
      CONSOLE_DATA_DIR: dataDir,
      CONSOLE_GATEWAY_SECRET: "",
      CONSOLE_REQUIRE_GATEWAY: "false",
      CONSOLE_MCP_SERVERS_JSON: "[]",
      HERMES_API_URL:
        "http://127.0.0.1:" + (upstream.address() as { port: number }).port,
      HERMES_API_KEY: randomBytes(32).toString("hex"),
      HERMES_ALLOW_LOOPBACK_HTTP: "true",
      MCP_BRIDGE_TOKEN: "",
      TKU_MCP_URL: "",
    },
  },
);
let logs = "";
child.stdout?.on("data", (d) => {
  logs += d;
});
child.stderr?.on("data", (d) => {
  logs += d;
});
const browser = await chromium.launch({ headless: true });
const output = resolve("output/playwright");
await mkdir(output, { recursive: true });
try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (child.exitCode !== null) throw new Error("Preview exited: " + logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const inspector = page.getByRole("region", { name: "Hermes Runtime 狀態" });
  await expect(
    inspector.getByText("fixture_tool_000", { exact: true }),
  ).toBeVisible();
  assert.ok(
    (await page.locator(".runtime-tool").count()) <= 100,
    "large registry must not mount every tool",
  );
  await inspector
    .getByRole("searchbox", { name: "搜尋工具用途" })
    .fill("fixture_tool_299");
  await expect(
    inspector.getByText("fixture_tool_299", { exact: true }),
  ).toBeVisible();
  await inspector.getByRole("searchbox").fill("background_added");
  const before = requests;
  names = [...names, "background_added"];
  // No refresh click or POST. Server monitor must publish this change.
  await expect(
    inspector.getByText("background_added", { exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  assert.ok(requests > before, "background worker did not discover");
  await context.setOffline(true);
  await expect(inspector.getByRole("alert")).toContainText("中斷", {
    timeout: 20_000,
  });
  await context.setOffline(false);
  await expect(inspector.getByRole("alert")).toHaveCount(0, {
    timeout: 25_000,
  });
  await expect(
    inspector.getByText("background_added", { exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [1440, 1000],
    [768, 1024],
    [390, 844],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "overflow at " + width,
    );
    await page.screenshot({
      path: join(output, "runtime-live-contract-" + width + ".png"),
      fullPage: true,
    });
    if (width < 800) {
      await inspector
        .getByText("background_added", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(output, "runtime-tools-contract-" + width + ".png"),
        fullPage: true,
      });
    }
  }
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "任務", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "任務", exact: true }),
  ).toBeVisible();
  await page
    .locator(".direction")
    .filter({
      has: page.getByRole("heading", { name: "測試方向 2", exact: true }),
    })
    .getByRole("button", { name: "選擇這個方向" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "訊息", exact: true }),
  ).toHaveValue(/第 2 個方向/);
  const saved = await (
    await context.request.get(base + "/api/workflows")
  ).json();
  assert.equal(
    saved.workflows.find((w: { id: string }) => w.id === workflow.id).selected,
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: production browser runtime, 300 tools/search, background update without refresh, offline/reconnect, four widths, persistent direction selection. HTTP fixtures, NOT live external services.",
  );
} finally {
  await browser.close();
  child.kill();
  upstream.closeAllConnections();
  upstream.close();
}
