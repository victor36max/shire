import { dirname, join } from "path";

/**
 * Resolves the project root directory for runtime assets (drizzle/, catalog/).
 *
 * In compiled binary: assets sit alongside the binary.
 * From source: project root is relative to the caller's __dirname.
 *
 * @param callerDirname - the calling file's __dirname
 * @param depth - how many levels up from callerDirname to reach project root (default: 1)
 */
export function getPackageRoot(callerDirname: string, depth = 1): string {
  if (process.argv[1]?.startsWith("/$bunfs/")) {
    return dirname(process.execPath);
  }
  let root = callerDirname;
  for (let i = 0; i < depth; i++) {
    root = join(root, "..");
  }
  return root;
}
