import { describe, it, expect } from "bun:test";
import { TARGETS, getTargetByBunTarget } from "../../scripts/build-targets";

describe("build-binaries target resolution", () => {
  describe("--target flag", () => {
    it("resolves bun-windows-x64", () => {
      const target = getTargetByBunTarget("bun-windows-x64");
      expect(target).toBeDefined();
      expect(target!.npmDir).toBe("win32-x64");
      expect(target!.binaryName).toBe("shire.exe");
    });

    it("resolves bun-darwin-arm64", () => {
      const target = getTargetByBunTarget("bun-darwin-arm64");
      expect(target).toBeDefined();
      expect(target!.npmDir).toBe("darwin-arm64");
      expect(target!.binaryName).toBe("shire");
    });

    it("resolves bun-linux-x64", () => {
      const target = getTargetByBunTarget("bun-linux-x64");
      expect(target).toBeDefined();
      expect(target!.npmDir).toBe("linux-x64");
    });

    it("resolves bun-linux-arm64", () => {
      const target = getTargetByBunTarget("bun-linux-arm64");
      expect(target).toBeDefined();
      expect(target!.npmDir).toBe("linux-arm64");
    });

    it("resolves bun-darwin-x64", () => {
      const target = getTargetByBunTarget("bun-darwin-x64");
      expect(target).toBeDefined();
      expect(target!.npmDir).toBe("darwin-x64");
    });

    it("returns undefined for unknown targets", () => {
      expect(getTargetByBunTarget("bun-freebsd-x64")).toBeUndefined();
    });
  });

  describe("all targets are valid", () => {
    it("has 5 platform targets", () => {
      expect(TARGETS).toHaveLength(5);
    });

    it("only windows target has .exe extension", () => {
      for (const target of TARGETS) {
        if (target.bunTarget.includes("windows")) {
          expect(target.binaryName).toEndWith(".exe");
        } else {
          expect(target.binaryName).not.toEndWith(".exe");
        }
      }
    });

    it("every bunTarget starts with bun-", () => {
      for (const target of TARGETS) {
        expect(target.bunTarget).toStartWith("bun-");
      }
    });
  });
});
