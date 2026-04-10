/**
 * Local type stubs for AI Elements components.
 * These replace the `ai` package's types to avoid pulling in the full AI SDK.
 */

/** Subset of AI SDK's UIMessage["role"] that we support */
export type MessageRole = "user" | "assistant" | "agent" | "tool_use" | "inter_agent" | "system";
