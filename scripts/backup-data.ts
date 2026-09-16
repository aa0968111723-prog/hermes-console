import { join } from "node:path";
import { runDataBackup } from "../lib/server/backup";

const destination = process.argv[2] || join(process.cwd(), "backups");
const result = runDataBackup(destination);
process.stdout.write(
  JSON.stringify(
    {
      backend: result.backend,
      destination: result.destination,
      copied: result.copied,
      missing: result.missing,
      postgresNote: result.postgresNote,
    },
    null,
    2,
  ) + "\n",
);
