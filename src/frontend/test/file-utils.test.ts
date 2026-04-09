import { describe, it, expect } from "bun:test";
import {
  getFileExtension,
  getPreviewType,
  formatSize,
  TEXT_EXTENSIONS,
  IMAGE_EXTENSIONS,
} from "../lib/file-utils";

describe("getFileExtension", () => {
  it("extracts extension from filename", () => {
    expect(getFileExtension("readme.md")).toBe("md");
    expect(getFileExtension("data.JSON")).toBe("json");
    expect(getFileExtension("archive.tar.gz")).toBe("gz");
  });

  it("returns name without dot for dotfiles", () => {
    expect(getFileExtension(".env")).toBe("env");
    expect(getFileExtension(".gitignore")).toBe("gitignore");
  });

  it("returns full name when no extension", () => {
    expect(getFileExtension("makefile")).toBe("makefile");
    expect(getFileExtension("dockerfile")).toBe("dockerfile");
  });
});

describe("getPreviewType", () => {
  it("returns markdown for .md and .mdx files", () => {
    expect(getPreviewType("readme.md")).toBe("markdown");
    expect(getPreviewType("article.mdx")).toBe("markdown");
  });

  it("returns text for known text extensions", () => {
    expect(getPreviewType("data.json")).toBe("text");
    expect(getPreviewType("script.py")).toBe("text");
    expect(getPreviewType("data.csv")).toBe("text");
    expect(getPreviewType("config.yaml")).toBe("text");
  });

  it("returns image for known image extensions", () => {
    expect(getPreviewType("photo.png")).toBe("image");
    expect(getPreviewType("logo.svg")).toBe("image");
  });

  it("returns pdf for .pdf files", () => {
    expect(getPreviewType("doc.pdf")).toBe("pdf");
  });

  it("returns unsupported for unknown types", () => {
    expect(getPreviewType("archive.zip")).toBe("unsupported");
    expect(getPreviewType("binary.exe")).toBe("unsupported");
  });

  it("handles extensionless filenames that match known sets", () => {
    expect(getPreviewType("makefile")).toBe("text");
    expect(getPreviewType("dockerfile")).toBe("text");
  });

  it("returns text for dotfiles like .env and .gitignore", () => {
    expect(getPreviewType(".env")).toBe("text");
    expect(getPreviewType(".gitignore")).toBe("text");
  });
});

describe("formatSize", () => {
  it("returns dash for zero bytes", () => {
    expect(formatSize(0)).toBe("—");
  });

  it("formats bytes", () => {
    expect(formatSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(2560)).toBe("2.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatSize(1048576)).toBe("1.0 MB");
  });
});

describe("extension sets", () => {
  it("TEXT_EXTENSIONS includes common code files", () => {
    expect(TEXT_EXTENSIONS.has("js")).toBe(true);
    expect(TEXT_EXTENSIONS.has("ts")).toBe(true);
    expect(TEXT_EXTENSIONS.has("py")).toBe(true);
    expect(TEXT_EXTENSIONS.has("csv")).toBe(true);
  });

  it("IMAGE_EXTENSIONS includes common image formats", () => {
    expect(IMAGE_EXTENSIONS.has("png")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("jpg")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("svg")).toBe(true);
  });
});
