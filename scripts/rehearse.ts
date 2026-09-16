import { rehearsalReport } from "../lib/server/rehearse";

const report = rehearsalReport();
console.log(
  JSON.stringify(
    {
      ok: report.ok,
      production: report.production,
      originConfigured: report.originConfigured,
      store: {
        backend: report.store.backend,
        ready: report.store.ready,
        sqlitePresent: report.store.sqlitePresent,
        vaultKeyPresent: report.store.vaultKeyPresent,
        writable: report.store.writable,
      },
      services: report.services,
      errors: report.errors,
      warnings: report.warnings,
    },
    null,
    2,
  ),
);
if (!report.ok) process.exit(1);
