import yaml from "js-yaml";

/**
 * Strip characters that js-yaml rejects as non-printable (C0, C1, DEL, BOM non-chars).
 * Preserves tab (\x09), newline (\x0A), carriage return (\x0D), and NEL (\x85).
 */
export function sanitizeYaml(input: string): string {
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]/g, "");
}

/** Parse YAML after stripping non-printable characters. */
export function safeYamlLoad<T>(content: string): T {
  return yaml.load(sanitizeYaml(content)) as T;
}
