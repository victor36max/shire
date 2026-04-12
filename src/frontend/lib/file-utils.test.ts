import { describe, expect, it } from "bun:test";
import { getFileIcon } from "./file-utils";
import {
  File,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  Database,
  Globe,
  Image,
  Settings,
} from "lucide-react";

describe("getFileIcon", () => {
  it("returns FileCode for source code files", () => {
    for (const ext of ["js", "ts", "jsx", "tsx", "py", "rb", "rs", "go", "java", "c", "cpp", "h"]) {
      expect(getFileIcon(`file.${ext}`)).toBe(FileCode);
    }
  });

  it("returns FileCode for shell scripts", () => {
    for (const ext of ["sh", "bash", "zsh"]) {
      expect(getFileIcon(`script.${ext}`)).toBe(FileCode);
    }
  });

  it("returns FileCode for Elixir/Erlang files", () => {
    for (const ext of ["ex", "exs", "erl"]) {
      expect(getFileIcon(`module.${ext}`)).toBe(FileCode);
    }
  });

  it("returns FileText for markdown files", () => {
    expect(getFileIcon("README.md")).toBe(FileText);
    expect(getFileIcon("notes.mdx")).toBe(FileText);
  });

  it("returns FileText for text and log files", () => {
    expect(getFileIcon("readme.txt")).toBe(FileText);
    expect(getFileIcon("server.log")).toBe(FileText);
  });

  it("returns FileJson for JSON/YAML/TOML files", () => {
    for (const ext of ["json", "yaml", "yml", "toml"]) {
      expect(getFileIcon(`config.${ext}`)).toBe(FileJson);
    }
  });

  it("returns Image for image files", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]) {
      expect(getFileIcon(`photo.${ext}`)).toBe(Image);
    }
  });

  it("returns FileSpreadsheet for CSV files", () => {
    expect(getFileIcon("data.csv")).toBe(FileSpreadsheet);
  });

  it("returns Globe for web files", () => {
    for (const ext of ["html", "css", "scss", "xml"]) {
      expect(getFileIcon(`page.${ext}`)).toBe(Globe);
    }
  });

  it("returns Database for SQL files", () => {
    expect(getFileIcon("schema.sql")).toBe(Database);
  });

  it("returns FileText for PDF files", () => {
    expect(getFileIcon("document.pdf")).toBe(FileText);
  });

  it("returns Settings for config/dotfiles", () => {
    expect(getFileIcon(".env")).toBe(Settings);
    expect(getFileIcon(".gitignore")).toBe(Settings);
    expect(getFileIcon("Dockerfile")).toBe(Settings);
    expect(getFileIcon("Makefile")).toBe(Settings);
  });

  it("returns generic File for unknown extensions", () => {
    expect(getFileIcon("archive.zip")).toBe(File);
    expect(getFileIcon("binary.bin")).toBe(File);
  });

  it("is case-insensitive", () => {
    expect(getFileIcon("App.TSX")).toBe(FileCode);
    expect(getFileIcon("DATA.CSV")).toBe(FileSpreadsheet);
    expect(getFileIcon("IMAGE.PNG")).toBe(Image);
  });
});
