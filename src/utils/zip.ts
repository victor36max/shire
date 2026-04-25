import { zipSync, type Zippable } from "fflate";
import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";

export const MAX_ZIP_TOTAL_SIZE = 512 * 1024 * 1024; // 512 MB uncompressed
export const MAX_ZIP_FILE_COUNT = 10_000;

/** Recursively collect all files under `root`, skipping symlinks. */
async function collectFiles(
  root: string,
  dir: string,
): Promise<Array<{ rel: string; size: number }>> {
  const results: Array<{ rel: string; size: number }> = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const full = join(dir, entry.name);
      const sub = await collectFiles(root, full);
      results.push(...sub);
    } else if (entry.isFile()) {
      const full = join(dir, entry.name);
      const s = await stat(full);
      results.push({ rel: relative(root, full), size: s.size });
    }
  }
  return results;
}

export interface ZipOptions {
  maxTotalSize?: number;
  maxFileCount?: number;
}

/**
 * Creates a ZIP archive buffer from a directory on disk.
 * Uses fflate for compression. Skips symlinks for security.
 * Enforces size and file count limits.
 */
export async function createZipBuffer(rootDir: string, options?: ZipOptions): Promise<Uint8Array> {
  const maxFileCount = options?.maxFileCount ?? MAX_ZIP_FILE_COUNT;
  const maxTotalSize = options?.maxTotalSize ?? MAX_ZIP_TOTAL_SIZE;

  const files = await collectFiles(rootDir, rootDir);

  if (files.length > maxFileCount) {
    throw new ZipLimitError(
      `Folder contains ${files.length} files, exceeding the ${maxFileCount} file limit`,
    );
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > maxTotalSize) {
    throw new ZipLimitError(
      `Folder is ${formatBytes(totalSize)}, exceeding the ${formatBytes(maxTotalSize)} limit`,
    );
  }

  const zipData: Zippable = {};
  for (const file of files) {
    const fullPath = join(rootDir, file.rel);
    const data = await readFile(fullPath);
    zipData[file.rel] = new Uint8Array(data);
  }

  return zipSync(zipData);
}

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
