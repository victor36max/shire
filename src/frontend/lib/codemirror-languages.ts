import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { go } from "@codemirror/lang-go";
import { rust } from "@codemirror/lang-rust";
import { markdown } from "@codemirror/lang-markdown";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { getFileExtension } from "./file-utils";

const extensionMap: Record<string, () => Extension> = {
  js: () => javascript({ jsx: true }),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ jsx: true, typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  py: () => python(),
  json: () => json(),
  yaml: () => yaml(),
  yml: () => yaml(),
  html: () => html(),
  xml: () => html(),
  css: () => css(),
  scss: () => css(),
  sql: () => sql(),
  go: () => go(),
  rs: () => rust(),
  md: () => markdown(),
  mdx: () => markdown(),
  sh: () => StreamLanguage.define(shell),
  bash: () => StreamLanguage.define(shell),
  zsh: () => StreamLanguage.define(shell),
};

export function getLanguageExtension(filePath: string): Extension | undefined {
  const ext = getFileExtension(filePath);
  const factory = extensionMap[ext];
  return factory?.();
}
