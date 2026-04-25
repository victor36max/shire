import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createZipBuffer } from "./zip";
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { inflateRawSync } from "zlib";

function readU16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

/** Parse a ZIP buffer and return an array of { name, data } entries. */
function parseZip(zip: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const results: Array<{ name: string; data: Uint8Array }> = [];

  // Find End of Central Directory (last 22+ bytes)
  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (readU32LE(zip, i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("No EOCD found");

  const entryCount = readU16LE(zip, eocdOffset + 10);
  const cdOffset = readU32LE(zip, eocdOffset + 16);

  let pos = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (readU32LE(zip, pos) !== 0x02014b50) throw new Error("Bad CD header");
    const method = readU16LE(zip, pos + 10);
    const compSize = readU32LE(zip, pos + 20);
    const uncompSize = readU32LE(zip, pos + 24);
    const nameLen = readU16LE(zip, pos + 28);
    const extraLen = readU16LE(zip, pos + 30);
    const commentLen = readU16LE(zip, pos + 32);
    const localOffset = readU32LE(zip, pos + 42);
    const name = new TextDecoder().decode(zip.slice(pos + 46, pos + 46 + nameLen));

    // Read compressed data from local file header
    const localNameLen = readU16LE(zip, localOffset + 26);
    const localExtraLen = readU16LE(zip, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compData = zip.slice(dataStart, dataStart + compSize);

    let data: Uint8Array;
    if (method === 8) {
      data = inflateRawSync(compData);
    } else {
      data = compData;
    }

    if (data.length !== uncompSize) {
      throw new Error(`Size mismatch for ${name}: got ${data.length}, expected ${uncompSize}`);
    }

    results.push({ name, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return results;
}

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
    const entries = parseZip(zip);

    expect(entries.length).toBe(2);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["data.json", "hello.txt"]);

    const hello = entries.find((e) => e.name === "hello.txt");
    expect(new TextDecoder().decode(hello!.data)).toBe("Hello, World!");

    const data = entries.find((e) => e.name === "data.json");
    expect(new TextDecoder().decode(data!.data)).toBe('{"key": "value"}');
  });

  it("handles nested subdirectories", async () => {
    mkdirSync(join(testDir, "sub", "deep"), { recursive: true });
    writeFileSync(join(testDir, "root.txt"), "root");
    writeFileSync(join(testDir, "sub", "mid.txt"), "mid");
    writeFileSync(join(testDir, "sub", "deep", "leaf.txt"), "leaf");

    const zip = await createZipBuffer(testDir);
    const entries = parseZip(zip);

    expect(entries.length).toBe(3);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["root.txt", "sub/deep/leaf.txt", "sub/mid.txt"]);

    const leaf = entries.find((e) => e.name === "sub/deep/leaf.txt");
    expect(new TextDecoder().decode(leaf!.data)).toBe("leaf");
  });

  it("produces a valid ZIP for an empty directory", async () => {
    const zip = await createZipBuffer(testDir);
    const entries = parseZip(zip);
    expect(entries.length).toBe(0);
  });

  it("skips symlinks", async () => {
    writeFileSync(join(testDir, "real.txt"), "real");
    symlinkSync(join(testDir, "real.txt"), join(testDir, "link.txt"));

    const zip = await createZipBuffer(testDir);
    const entries = parseZip(zip);

    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe("real.txt");
  });

  it("handles binary files correctly", async () => {
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    writeFileSync(join(testDir, "binary.bin"), binaryData);

    const zip = await createZipBuffer(testDir);
    const entries = parseZip(zip);

    expect(entries.length).toBe(1);
    expect(Buffer.from(entries[0].data)).toEqual(binaryData);
  });

  it("handles empty files", async () => {
    writeFileSync(join(testDir, "empty.txt"), "");

    const zip = await createZipBuffer(testDir);
    const entries = parseZip(zip);

    expect(entries.length).toBe(1);
    expect(entries[0].data.length).toBe(0);
  });
});
