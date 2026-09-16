import { copyFileSync, cpSync, existsSync, mkdirSync, chmodSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { dataDir, sqliteFile, storeBackend } from "./store";
import { vaultKeyPath } from "./vault";

export type BackupResult = {
  ok: boolean;
  directory: string;
  files: string[];
  postgres: boolean;
  message: string;
};

function backupRoot() {
  return resolve(process.env.CONSOLE_BACKUP_DIR || join(dataDir(), "backups"));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function copyIfPresent(src: string, destDir: string, name: string, files: string[]) {
  if (!existsSync(src)) return;
  const dest = join(destDir, name);
  copyFileSync(src, dest);
  chmodSync(dest, 0o600);
  files.push(name);
}

function postgresDumpEnv(urlString: string) {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("DATABASE_URL 不是有效網址。");
  }
  if (!/^postgres(ql)?:$/i.test(url.protocol))
    throw new Error("DATABASE_URL 必須是 postgres 連線。");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "").split("/")[0] || ""),
  };
}

function dumpPostgres(destDir: string, files: string[]) {
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) return false;
  const dump = join(destDir, "console-postgres.dump");
  try {
    execFileSync(
      "pg_dump",
      ["--no-password", "--format=custom", "--file", dump],
      {
        env: postgresDumpEnv(url),
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    chmodSync(dump, 0o600);
    files.push("console-postgres.dump");
    return true;
  } catch (error) {
    const missing =
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT";
    throw new Error(missing ? "未安裝 pg_dump，無法備份 Postgres。" : "Postgres 備份失敗。");
  }
}

/** Copy SQLite/WAL/vault and optionally pg_dump. Never prints secrets. */
export function createBackup(directory?: string): BackupResult {
  const dest = resolve(directory || join(backupRoot(), "hermes-" + stamp()));
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const files: string[] = [];
  const sqlite = sqliteFile();
  copyIfPresent(sqlite, dest, "console.sqlite", files);
  copyIfPresent(sqlite + "-wal", dest, "console.sqlite-wal", files);
  copyIfPresent(sqlite + "-shm", dest, "console.sqlite-shm", files);
  copyIfPresent(vaultKeyPath(), dest, "vault.key", files);
  let postgres = false;
  let message = "";
  try {
    postgres = dumpPostgres(dest, files);
  } catch (error) {
    message = error instanceof Error ? error.message : "Postgres 備份失敗。";
  }
  writeFileSync(
    join(dest, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        backend: storeBackend(),
        files,
        postgres,
      },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  files.push("manifest.json");
  const ok = files.length > 1 && !message;
  return {
    ok,
    directory: dest,
    files,
    postgres,
    message: message || (ok ? "備份完成。" : "沒有可備份的資料檔。"),
  };
}

export type DataBackupResult = {
  backend: "sqlite" | "postgres";
  sourceDir: string;
  destination: string;
  copied: string[];
  missing: string[];
  postgresNote: string | null;
};

export function runDataBackup(destinationRoot: string, now = new Date()): DataBackupResult {
  const sourceDir = dataDir();
  const destination = join(resolve(destinationRoot), "hermes-" + now.toISOString().replace(/[:.]/g, "-"));
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  chmodSync(destination, 0o700);
  const copied: string[] = [];
  const missing: string[] = [];
  copyIfPresent(sqliteFile(), destination, "console.sqlite", copied);
  copyIfPresent(vaultKeyPath(), destination, "vault.key", copied);
  if (!copied.includes("console.sqlite")) missing.push("console.sqlite");
  if (!copied.includes("vault.key")) missing.push("vault.key");
  const uploads = join(sourceDir, "uploads");
  if (existsSync(uploads)) {
    cpSync(uploads, join(destination, "uploads"), { recursive: true });
    copied.push("uploads");
  } else {
    missing.push("uploads");
  }
  const postgres = /^postgres(ql)?:\/\//i.test((process.env.DATABASE_URL || "").trim());
  return {
    backend: postgres ? "postgres" : "sqlite",
    sourceDir,
    destination,
    copied,
    missing,
    postgresNote: postgres
      ? "DATABASE_URL 已設定。請另外對受管 Postgres 執行 pg_dump（不要把連線字串寫進備份紀錄）。SQLite／vault 檔若存在會一併複製作為遷移殘件。"
      : null,
  };
}
