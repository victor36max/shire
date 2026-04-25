import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";

const MAX_TOTAL_SIZE = 512 * 1024 * 1024; // 512 MB uncompressed
const MAX_FILE_COUNT = 10_000;

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

function writeU16LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
}

function writeU32LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
  buf[offset + 2] = (val >> 16) & 0xff;
  buf[offset + 3] = (val >> 24) & 0xff;
}

interface LocalEntry {
  rel: string;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  offset: number;
}

/**
 * Creates a ZIP archive buffer from a directory on disk.
 * Uses Bun.deflateSync for compression and Bun.hash.crc32 for checksums.
 * Skips symlinks for security. Enforces size and file count limits.
 */
export async function createZipBuffer(rootDir: string): Promise<Uint8Array> {
  const files = await collectFiles(rootDir, rootDir);

  if (files.length > MAX_FILE_COUNT) {
    throw new ZipLimitError(
      `Folder contains ${files.length} files, exceeding the ${MAX_FILE_COUNT} file limit`,
    );
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    throw new ZipLimitError(
      `Folder is ${formatBytes(totalSize)}, exceeding the ${formatBytes(MAX_TOTAL_SIZE)} limit`,
    );
  }

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const entries: LocalEntry[] = [];

  for (const file of files) {
    const fullPath = join(rootDir, file.rel);
    const data = await readFile(fullPath);
    const crc = Bun.hash.crc32(data) >>> 0; // force unsigned 32-bit
    const shouldCompress = data.length > 0;
    const compressed = shouldCompress ? Bun.deflateSync(data, { windowBits: -15 }) : data;
    const method = shouldCompress ? 8 : 0; // DEFLATE or STORED
    const fileNameBytes = new TextEncoder().encode(file.rel);

    // Local File Header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    writeU32LE(localHeader, 0, 0x04034b50); // signature
    writeU16LE(localHeader, 4, 20); // version needed (2.0)
    writeU16LE(localHeader, 6, 0x0800); // general purpose bit flag (UTF-8)
    writeU16LE(localHeader, 8, method); // compression method
    writeU16LE(localHeader, 10, 0); // mod time
    writeU16LE(localHeader, 12, 0); // mod date
    writeU32LE(localHeader, 14, crc); // crc-32
    writeU32LE(localHeader, 18, compressed.length); // compressed size
    writeU32LE(localHeader, 22, data.length); // uncompressed size
    writeU16LE(localHeader, 26, fileNameBytes.length); // filename length
    writeU16LE(localHeader, 28, 0); // extra field length
    localHeader.set(fileNameBytes, 30);

    entries.push({
      rel: file.rel,
      crc32: crc,
      compressedSize: compressed.length,
      uncompressedSize: data.length,
      method,
      offset,
    });

    chunks.push(localHeader, compressed);
    offset += localHeader.length + compressed.length;
  }

  // Central Directory
  const centralStart = offset;
  for (const entry of entries) {
    const fileNameBytes = new TextEncoder().encode(entry.rel);
    const cdHeader = new Uint8Array(46 + fileNameBytes.length);
    writeU32LE(cdHeader, 0, 0x02014b50); // signature
    writeU16LE(cdHeader, 4, 20); // version made by
    writeU16LE(cdHeader, 6, 20); // version needed
    writeU16LE(cdHeader, 8, 0x0800); // general purpose bit flag (UTF-8)
    writeU16LE(cdHeader, 10, entry.method); // compression method
    writeU16LE(cdHeader, 12, 0); // mod time
    writeU16LE(cdHeader, 14, 0); // mod date
    writeU32LE(cdHeader, 16, entry.crc32); // crc-32
    writeU32LE(cdHeader, 20, entry.compressedSize); // compressed size
    writeU32LE(cdHeader, 24, entry.uncompressedSize); // uncompressed size
    writeU16LE(cdHeader, 28, fileNameBytes.length); // filename length
    writeU16LE(cdHeader, 30, 0); // extra field length
    writeU16LE(cdHeader, 32, 0); // file comment length
    writeU16LE(cdHeader, 34, 0); // disk number start
    writeU16LE(cdHeader, 36, 0); // internal file attributes
    writeU32LE(cdHeader, 38, 0); // external file attributes
    writeU32LE(cdHeader, 42, entry.offset); // relative offset of local header
    cdHeader.set(fileNameBytes, 46);

    chunks.push(cdHeader);
    offset += cdHeader.length;
  }

  const centralSize = offset - centralStart;

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  writeU32LE(eocd, 0, 0x06054b50); // signature
  writeU16LE(eocd, 4, 0); // disk number
  writeU16LE(eocd, 6, 0); // disk with central directory
  writeU16LE(eocd, 8, entries.length); // entries on this disk
  writeU16LE(eocd, 10, entries.length); // total entries
  writeU32LE(eocd, 12, centralSize); // size of central directory
  writeU32LE(eocd, 16, centralStart); // offset of central directory
  writeU16LE(eocd, 20, 0); // comment length
  chunks.push(eocd);

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
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
