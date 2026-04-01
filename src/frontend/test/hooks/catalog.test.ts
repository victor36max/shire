import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { waitFor } from "@testing-library/react";
import { server } from "../msw-server";
import { renderHookWithProviders } from "../test-utils";
import { useCatalogAgents, useCatalogAgent } from "../../hooks/catalog";

const agents = [
  { name: "code-reviewer", title: "Code Reviewer", category: "dev" },
  { name: "writer", title: "Writer", category: "content" },
];

const agentDetail = {
  name: "code-reviewer",
  title: "Code Reviewer",
  category: "dev",
  description: "Reviews code",
};

describe("useCatalogAgents", () => {
  it("does not fetch when enabled is false", async () => {
    const { result } = renderHookWithProviders(() => useCatalogAgents(false));
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches when enabled is true", async () => {
    server.use(http.get("*/api/catalog/agents", () => HttpResponse.json(agents)));
    const { result } = renderHookWithProviders(() => useCatalogAgents(true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(agents);
  });
});

describe("useCatalogAgent", () => {
  it("fetches when name is provided", async () => {
    server.use(http.get("*/api/catalog/agents/:name", () => HttpResponse.json(agentDetail)));
    const { result } = renderHookWithProviders(() => useCatalogAgent("code-reviewer"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(agentDetail);
  });

  it("does not fetch when name is undefined", async () => {
    const { result } = renderHookWithProviders(() => useCatalogAgent(undefined));
    expect(result.current.fetchStatus).toBe("idle");
  });
});
