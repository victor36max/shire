import { defineConfig } from "drizzle-kit";
import { join } from "path";
import { homedir } from "os";

const dataDir = process.env.SHIRE_DATA_DIR || join(homedir(), ".shire");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: join(dataDir, "shire.db"),
  },
});
