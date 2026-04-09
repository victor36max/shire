export type PreviewType = "markdown" | "text" | "image" | "pdf" | "unsupported";

export const TEXT_EXTENSIONS = new Set([
  "txt",
  "json",
  "yaml",
  "yml",
  "toml",
  "csv",
  "log",
  "sh",
  "bash",
  "zsh",
  "js",
  "ts",
  "jsx",
  "tsx",
  "py",
  "rb",
  "ex",
  "exs",
  "erl",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "html",
  "css",
  "scss",
  "xml",
  "sql",
  "env",
  "gitignore",
  "dockerfile",
  "makefile",
]);

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);

export function getFileExtension(name: string): string {
  const lower = name.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex > 0) return lower.slice(dotIndex + 1); // "readme.md" → "md"
  if (dotIndex === 0) return lower.slice(1); // ".env" → "env"
  return lower; // "makefile" → "makefile"
}

export function getPreviewType(name: string): PreviewType {
  const ext = getFileExtension(name);
  if (ext === "md" || ext === "mdx") return "markdown";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "unsupported";
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MAX_UPLOAD_SIZE = 128 * 1024 * 1024; // 128 MB
