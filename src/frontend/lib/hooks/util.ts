import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ClientResponse } from "hono/client";
import type { SuccessStatusCode } from "hono/utils/http-status";

/** Wraps a mutation with automatic error toasts */
export function withErrorToast<TData, TVariables>(
  opts: Parameters<typeof useMutation<TData, Error, TVariables>>[0],
): Parameters<typeof useMutation<TData, Error, TVariables>>[0] {
  return {
    ...opts,
    onError: (error, variables, onMutateResult, context) => {
      toast.error(error.message || "Something went wrong");
      opts.onError?.(error, variables, onMutateResult, context);
    },
  };
}

/**
 * Extracts the success response data type from a Hono ClientResponse union.
 * Distributes over status codes so that only 2xx responses contribute to the result type.
 */
type FilterSuccess<D, S> = S extends SuccessStatusCode ? D : never;
export type SuccessData<T> =
  T extends ClientResponse<infer D, infer S, string> ? FilterSuccess<D, S> : never;

/**
 * Extracts JSON from a Hono RPC response, throwing on non-2xx status.
 * Preserves the same error semantics as the old fetchJson helper.
 */
export async function unwrap<T extends ClientResponse<unknown, number, string>>(
  response: T,
): Promise<SuccessData<T>> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = response.statusText || `${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  return response.json() as Promise<SuccessData<T>>;
}
