import { describe, it, expect } from "bun:test";
import { unwrap, type SuccessData } from "./util";
import type { ClientResponse } from "hono/client";

describe("unwrap", () => {
  it("returns parsed JSON on 200", async () => {
    const response = new Response(JSON.stringify({ id: 1, name: "test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const result = await unwrap(response as never);
    expect(result as unknown).toEqual({ id: 1, name: "test" });
  });

  it("throws with JSON error message on 400", async () => {
    const response = new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

    await expect(unwrap(response as never)).rejects.toThrow("Bad request");
  });

  it("throws with statusText on 500 when body is not JSON", async () => {
    const response = new Response("something broke", {
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(unwrap(response as never)).rejects.toThrow("Internal Server Error");
  });

  it("throws with status code when no statusText and empty body", async () => {
    const response = new Response("", { status: 422 });

    await expect(unwrap(response as never)).rejects.toThrow("422");
  });

  it("throws with status code fallback when .text() rejects", async () => {
    const response = {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: () => Promise.reject(new Error("read failed")),
      json: () => Promise.reject(new Error("json failed")),
    };

    await expect(unwrap(response as never)).rejects.toThrow("Service Unavailable");
  });
});

describe("SuccessData type", () => {
  it("extracts type from successful response", () => {
    // Type-level test: just verify it compiles
    type TestResponse = ClientResponse<{ name: string }, 200, "json">;
    type Result = SuccessData<TestResponse>;
    const _check: Result = { name: "test" };
    expect(_check.name).toBe("test");
  });
});
