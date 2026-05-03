import { resolve } from "path";

/**
 * Resolves a user-supplied path inside a project's shared root, rejecting any
 * path that would escape the root (via traversal, absolute paths, or prefix
 * collisions like `/shared` vs `/shared-evil`). Returns the absolute resolved
 * path on success, or `null` if the path escapes the root.
 */
export function safePath(sharedRoot: string, userPath: string): string | null {
  const normalized = userPath === "/" || userPath === "" ? "." : userPath.replace(/^\/+/, "");
  const resolved = resolve(sharedRoot, normalized);
  if (resolved !== sharedRoot && !resolved.startsWith(sharedRoot + "/")) return null;
  return resolved;
}
