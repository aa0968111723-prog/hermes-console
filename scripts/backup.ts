import { createBackup } from "../lib/server/backup";

const result = createBackup();
console.log(result.message);
console.log("files=" + result.files.length);
if (!result.ok) process.exit(1);
