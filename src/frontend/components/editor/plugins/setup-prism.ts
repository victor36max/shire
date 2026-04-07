// @lexical/code-prism reads `globalThis.Prism` at module init time.
// Bun's bundler can reorder bare side-effect imports, so we explicitly
// import the Prism default export and assign it to globalThis before
// @lexical/code-prism is imported.
import Prism from "prismjs";

if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).Prism = Prism;
}
