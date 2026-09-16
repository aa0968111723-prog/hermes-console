import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { dataDir, sqliteFile } from "./store";
import { vaultKeyPath } from "./vault";

export type BackupResult = {
  backend: "sqlite" | "postgres";
  sourceDir: string;
  destination: string;
  copied: string[];
  missing: string[];
  postgresNote: string | null;
};

function postgresConfigured() {
  return /^postgres(ql)?:\/\//i.test((process.env.DATABASE_URL || "").trim());
}

function stamp(now: Date) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function copyIfPresent(
  source: string,
  destination: string,
  copied: string[],
  missing: string[],
  label: string,
) {
  if (!existsSync(source)) {
    missing.push(label);
    return;
  }
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  copied.push(label);
}

export function runDataBackup(destinationRoot: string, now = new Date()): BackupResult {
  const sourceDir = dataDir();
  const destination = join(resolve(destinationRoot), "hermes-" + stamp(now));
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  chmodSync(destination, 0o700);

  const copied: string[] = [];
  const missing: string[] = [];
  copyIfPresent(
    sqliteFile(),
    join(destination, "console.sqlite"),
    copied,
    missing,
    "console.sqlite",
  );
  copyIfPresent(
    vaultKeyPath(),
    join(destination, "vault.key"),
    copied,
    missing,
    "vault.key",
  );

  const uploads = join(sourceDir, "uploads");
  if (existsSync(uploads)) {
    const target = join(destination, "uploads");
    cpSync(uploads, target, { recursive: true });
    copied.push("uploads");
  } else {
    missing.push("uploads");
  }

  const postgres = postgresConfigured();
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
