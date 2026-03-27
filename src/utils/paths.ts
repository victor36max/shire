import { dirname } from "path";
import { fileURLToPath } from "url";

/** Get __dirname equivalent for ESM modules */
export function getDirname(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}
