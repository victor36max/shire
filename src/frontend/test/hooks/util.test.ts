import { describe, it, expect } from "bun:test";
import { unwrap } from "../../hooks/util";

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
});
