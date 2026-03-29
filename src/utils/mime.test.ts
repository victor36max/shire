import { describe, expect, test } from "bun:test";
import { mimeFromPath } from "./mime";

describe("mimeFromPath", () => {
  test("returns image/png for .png files", () => {
    expect(mimeFromPath("photo.png")).toBe("image/png");
  });

  test("returns image/jpeg for .jpg and .jpeg files", () => {
    expect(mimeFromPath("photo.jpg")).toBe("image/jpeg");
    expect(mimeFromPath("photo.jpeg")).toBe("image/jpeg");
  });

  test("handles case-insensitive extensions", () => {
    expect(mimeFromPath("photo.PNG")).toBe("image/png");
    expect(mimeFromPath("photo.JPEG")).toBe("image/jpeg");
  });

  test("returns application/pdf for .pdf files", () => {
    expect(mimeFromPath("doc.pdf")).toBe("application/pdf");
  });

  test("returns application/octet-stream for unknown extensions", () => {
    expect(mimeFromPath("file.xyz")).toBe("application/octet-stream");
  });

  test("returns application/octet-stream for files without extension", () => {
    expect(mimeFromPath("noext")).toBe("application/octet-stream");
  });

  test("returns image/webp for .webp files", () => {
    expect(mimeFromPath("image.webp")).toBe("image/webp");
  });
});
