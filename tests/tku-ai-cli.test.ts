import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repoRoot, "runtime/tku-ai/bin/tku-ai");

type CliEnv = Record<string, string | undefined>;

async function run(
  args: string[],
  env: CliEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("sh", [cli, ...args], {
      env: { ...process.env, ...env },
      timeout: 8000,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function hermesShim(): string {
  return ["#!/bin/sh", "printf 'HERMES_ARGS:%s\\n' \"$*\"", ""].join("\n");
}

test("help explains the wrapper and does not need hermes", async () => {
  const { code, stdout, stderr } = await run(["--help"], {
    PATH: "/usr/bin:/bin",
  });
  assert.equal(code, 0);
  assert.match(stdout, /TKU AI CLI/);
  assert.match(stdout, /hermes --tui/);
  assert.match(stdout, /不是第二個大腦/);
  assert.equal(stderr, "");
});

test("version prints wrapper version without leaking secrets", async () => {
  const { code, stdout } = await run(["version"], {
    PATH: "/usr/bin:/bin",
    API_SERVER_KEY: "should-not-appear-in-output-aaaaaaaa",
  });
  assert.equal(code, 0);
  assert.match(stdout, /^tku-ai 0\.1\.0/m);
  assert.doesNotMatch(stdout, /should-not-appear-in-output-aaaaaaaa/);
});

test("doctor reports missing hermes and missing profile without printing .env secrets", async () => {
  const home = await mkdtemp(join(tmpdir(), "tku-ai-doctor-"));
  await mkdir(join(home, "skills"), { recursive: true });
  await writeFile(
    join(home, ".env"),
    [
      "API_SERVER_ENABLED=true",
      "API_SERVER_HOST=127.0.0.1",
      "API_SERVER_PORT=8642",
      "API_SERVER_KEY=super-secret-key-xyz-9876",
      "API_SERVER_MODEL_NAME=hermes-agent",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const { code, stdout, stderr } = await run(["doctor"], {
    PATH: "/usr/bin:/bin",
    HOME: home,
    HERMES_HOME: home,
  });

  assert.notEqual(code, 0);
  assert.match(stdout, /hermes: 未安裝/);
  assert.match(stdout, /API_SERVER_KEY: 已設定（末四碼 9876）/);
  assert.doesNotMatch(stdout, /super-secret-key-xyz-9876/);
  assert.doesNotMatch(stderr, /super-secret-key-xyz-9876/);
});

test("unknown commands pass through to hermes", async () => {
  const bin = await mkdtemp(join(tmpdir(), "tku-ai-path-"));
  const fakeHermes = join(bin, "hermes");
  await writeFile(fakeHermes, hermesShim(), { mode: 0o755 });
  await chmod(fakeHermes, 0o755);

  const { code, stdout } = await run(["tools"], {
    PATH: `${bin}:/usr/bin:/bin`,
  });
  assert.equal(code, 0);
  assert.equal(stdout, "HERMES_ARGS:tools\n");
});

test("chat subcommand execs hermes chat", async () => {
  const bin = await mkdtemp(join(tmpdir(), "tku-ai-chat-"));
  const fakeHermes = join(bin, "hermes");
  await writeFile(fakeHermes, hermesShim(), { mode: 0o755 });
  await chmod(fakeHermes, 0o755);

  const { code, stdout } = await run(["chat", "-q", "ping"], {
    PATH: `${bin}:/usr/bin:/bin`,
  });
  assert.equal(code, 0);
  assert.equal(stdout, "HERMES_ARGS:chat -q ping\n");
});
