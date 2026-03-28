import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  interface Matchers<T> extends TestingLibraryMatchers<
    ReturnType<typeof expect.stringContaining>,
    T
  > {
    // Extends bun:test Matchers with jest-dom matchers
    _brand?: "jest-dom";
  }
  interface AsymmetricMatchers extends TestingLibraryMatchers {
    // Extends bun:test AsymmetricMatchers with jest-dom matchers
    _brand?: "jest-dom";
  }
}
