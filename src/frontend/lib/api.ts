import { hc } from "hono/client";
import type { AppType } from "../../server";

const client = hc<AppType>("/");

// Fully typed RPC client — request bodies and response types
// are inferred from zValidator schemas on the backend.
export const api = client.api;
