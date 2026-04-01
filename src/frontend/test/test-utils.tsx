import * as React from "react";
import {
  render,
  renderHook,
  screen,
  type RenderOptions,
  type RenderHookOptions,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

interface WrapperOptions {
  route?: string;
  /** When set, wraps the component inside <Routes><Route path={routePath}> so useParams() works */
  routePath?: string;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: WrapperOptions & Omit<RenderOptions, "wrapper">,
) {
  const { route = "/", routePath, ...renderOptions } = options ?? {};
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          {routePath ? (
            <Routes>
              <Route path={routePath} element={children} />
            </Routes>
          ) : (
            children
          )}
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), queryClient };
}

export function renderHookWithProviders<Result, Props>(
  hook: (props: Props) => Result,
  options?: WrapperOptions & Omit<RenderHookOptions<Props>, "wrapper">,
) {
  const { route = "/", routePath, ...hookOptions } = options ?? {};
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          {routePath ? (
            <Routes>
              <Route path={routePath} element={children} />
            </Routes>
          ) : (
            children
          )}
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { ...renderHook(hook, { wrapper: Wrapper, ...hookOptions }), queryClient };
}

/**
 * Poll-based waitFor for happy-dom, which doesn't support MutationObserver-based
 * change detection needed by testing-library's waitFor for async React Query updates.
 */
export async function waitForText(
  text: string | RegExp,
  { timeout = 3000 }: { timeout?: number } = {},
): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = screen.queryByText(text);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 50));
  }
  // Final attempt — let getByText throw with a proper error message
  return screen.getByText(text);
}
