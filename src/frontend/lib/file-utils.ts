import type { LucideIcon } from "lucide-react";
import {
  Database,
  File,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  Globe,
  Image,
  Settings,
} from "lucide-react";

export type PreviewType = "markdown" | "text" | "csv" | "image" | "pdf" | "unsupported";

export const TEXT_EXTENSIONS = new Set([
  "txt",
  "json",
  "yaml",
  "yml",
  "toml",
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
  if (ext === "csv") return "csv";
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

const CODE_EXTENSIONS = new Set([
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
  "sh",
  "bash",
  "zsh",
]);

const CONFIG_DATA_EXTENSIONS = new Set(["json", "yaml", "yml", "toml"]);
const WEB_EXTENSIONS = new Set(["html", "css", "scss", "xml"]);
const DOTFILE_EXTENSIONS = new Set(["env", "gitignore", "dockerfile", "makefile"]);

export function getFileIcon(name: string): LucideIcon {
  const ext = getFileExtension(name);
  if (CODE_EXTENSIONS.has(ext)) return FileCode;
  if (ext === "md" || ext === "mdx") return FileText;
  if (ext === "txt" || ext === "log") return FileText;
  if (CONFIG_DATA_EXTENSIONS.has(ext)) return FileJson;
  if (IMAGE_EXTENSIONS.has(ext)) return Image;
  if (ext === "csv") return FileSpreadsheet;
  if (WEB_EXTENSIONS.has(ext)) return Globe;
  if (ext === "sql") return Database;
  if (ext === "pdf") return FileText;
  if (DOTFILE_EXTENSIONS.has(ext)) return Settings;
  return File;
}
