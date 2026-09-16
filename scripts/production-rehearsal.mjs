import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!existsSync(".next")) {
  console.error("缺少 .next 建置產物。請先執行 npm run build。");
  process.exit(1);
}

const port = Number(process.env.REHEARSAL_PORT || 3991);
const base = "http://127.0.0.1:" + port;
const dataDir = await mkdtemp(join(tmpdir(), "hermes-rehearse-"));
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"],
  {
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_ORIGIN: base,
      CONSOLE_ALLOW_LOCAL_ACCESS: "true",
      CONSOLE_GATEWAY_SECRET: "",
      CONSOLE_REQUIRE_GATEWAY: "false",
      CONSOLE_ADMIN_EMAILS: "",
      RESEND_API_KEY: "",
      CONSOLE_EMAIL_FROM: "",
      CONSOLE_DATA_DIR: dataDir,
      HERMES_API_URL: "",
      HERMES_API_KEY: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
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

function looksSecret(text) {
  return (
    /postgres(?:ql)?:\/\/\S+/i.test(text) ||
    /DATABASE_URL\s*=/.test(text) ||
    /Bearer\s+[A-Za-z0-9._\-+=/]{8,}/.test(text) ||
    /CONSOLE_GATEWAY_SECRET/.test(text) ||
    /GOOGLE_CLIENT_SECRET/.test(text) ||
    /HERMES_API_KEY"\s*:\s*"[^"]+"/.test(text) ||
    /sk-[a-zA-Z0-9_-]{12,}/.test(text)
  );
}

function assertPublicJson(label, body) {
  const text = JSON.stringify(body);
  if (looksSecret(text)) throw new Error(label + " JSON 含疑似秘密欄位。");
}

function redact(text) {
  return String(text || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /(password|secret|token|authorization|api[_-]?key)["']?\s*[:=]\s*["']?[^"' \n]+/gi,
      "$1=[redacted]",
    );
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) {
      fail("正式預覽伺服器無法啟動。");
      const hint = redact(logs).trim().slice(-400);
      if (hint) console.error(hint);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (process.exitCode) {
    // already failed
  } else if (!ready) {
    fail("正式預覽伺服器逾時未回應。");
  } else {
    const home = await fetch(base);
    if (!home.ok) throw new Error("GET / 應為 200。");

    const health = await fetch(base + "/api/health");
    if (health.status !== 200) throw new Error("GET /api/health 應為 200。");
    const healthBody = await health.json();
    if (healthBody.live !== true) throw new Error("health.live 應為 true。");
    if (typeof healthBody.ready !== "boolean")
      throw new Error("health.ready 缺失。");
    if (typeof healthBody.agentReady !== "boolean")
      throw new Error("health.agentReady 缺失。");
    assertPublicJson("health", healthBody);

    const readyResponse = await fetch(base + "/api/ready");
    if (![200, 503].includes(readyResponse.status))
      throw new Error("GET /api/ready 狀態異常。");
    const readyBody = await readyResponse.json();
    if (typeof readyBody.ready !== "boolean")
      throw new Error("ready.ready 缺失。");
    assertPublicJson("ready", readyBody);

    const workspace = await fetch(base + "/api/workspace");
    if (workspace.status !== 401)
      throw new Error("workspace GET 必須要求 session。");

    console.log(
      "PASS: local production rehearsal (loopback health/ready/401). Not live Zeabur.",
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "rehearsal failed");
} finally {
  child.kill();
}
