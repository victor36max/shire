import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createZipBuffer, ZipLimitError, type ZipOptions } from "./zip";
import { unzipSync } from "fflate";
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("createZipBuffer", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `zip_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates a valid ZIP from a directory with files", async () => {
    writeFileSync(join(testDir, "hello.txt"), "Hello, World!");
    writeFileSync(join(testDir, "data.json"), '{"key": "value"}');

    const zip = await createZipBuffer(testDir);
    const entries = unzipSync(zip);

    expect(Object.keys(entries).sort()).toEqual(["data.json", "hello.txt"]);
    expect(new TextDecoder().decode(entries["hello.txt"])).toBe("Hello, World!");
    expect(new TextDecoder().decode(entries["data.json"])).toBe('{"key": "value"}');
  });

  it("handles nested subdirectories", async () => {
    mkdirSync(join(testDir, "sub", "deep"), { recursive: true });
    writeFileSync(join(testDir, "root.txt"), "root");
    writeFileSync(join(testDir, "sub", "mid.txt"), "mid");
    writeFileSync(join(testDir, "sub", "deep", "leaf.txt"), "leaf");

    const zip = await createZipBuffer(testDir);
    const entries = unzipSync(zip);

    expect(Object.keys(entries).sort()).toEqual(["root.txt", "sub/deep/leaf.txt", "sub/mid.txt"]);
    expect(new TextDecoder().decode(entries["sub/deep/leaf.txt"])).toBe("leaf");
  });

  it("produces a valid ZIP for an empty directory", async () => {
    const zip = await createZipBuffer(testDir);
    const entries = unzipSync(zip);
    expect(Object.keys(entries).length).toBe(0);
  });

  it("skips symlinks", async () => {
    writeFileSync(join(testDir, "real.txt"), "real");
    symlinkSync(join(testDir, "real.txt"), join(testDir, "link.txt"));

    const zip = await createZipBuffer(testDir);
    const entries = unzipSync(zip);

    expect(Object.keys(entries)).toEqual(["real.txt"]);
  });

  it("handles binary files correctly", async () => {
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    writeFileSync(join(testDir, "binary.bin"), binaryData);

    const zip = await createZipBuffer(testDir);
    const entries = unzipSync(zip);

    expect(Buffer.from(entries["binary.bin"])).toEqual(binaryData);
  });

  it("handles empty files", async () => {
    writeFileSync(join(testDir, "empty.txt"), "");

    const zip = await createZipBuffer(testDir);
    const entries = unzipSync(zip);

    expect(entries["empty.txt"].length).toBe(0);
  });

  it("throws ZipLimitError when file count exceeds limit", async () => {
    writeFileSync(join(testDir, "a.txt"), "a");
    writeFileSync(join(testDir, "b.txt"), "b");
    writeFileSync(join(testDir, "c.txt"), "c");

    const opts: ZipOptions = { maxFileCount: 2 };
    await expect(createZipBuffer(testDir, opts)).rejects.toThrow(ZipLimitError);
  });

  it("throws ZipLimitError when total size exceeds limit", async () => {
    writeFileSync(join(testDir, "big.txt"), "x".repeat(100));

    const opts: ZipOptions = { maxTotalSize: 50 };
    await expect(createZipBuffer(testDir, opts)).rejects.toThrow(ZipLimitError);
  });
});
