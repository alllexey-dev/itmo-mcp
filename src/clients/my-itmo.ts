import createClient, { type Client } from "openapi-fetch";
import type { TokenManager } from "../auth/token-manager.js";
import type { paths } from "../generated/my-itmo.js";
import { authorizedFetch, type FetchFn } from "../http.js";
import { type Fetched, ItmoApiError, settle } from "./errors.js";

export const MY_ITMO_URL = "https://my.itmo.ru";

export type MyItmoClient = Client<paths>;

export interface MyItmoClientOptions {
  tokens: Pick<TokenManager, "accessToken" | "forceRefresh">;
  fetchFn?: FetchFn;
  baseUrl?: string;
  language?: "ru" | "en";
}

export function createMyItmoClient({
  tokens,
  fetchFn = fetch,
  baseUrl = MY_ITMO_URL,
  language = "ru",
}: MyItmoClientOptions): MyItmoClient {
  const credential = {
    current: async () => `Bearer ${await tokens.accessToken()}`,
    rejected: async () => `Bearer ${await tokens.forceRefresh()}`,
  };
  return createClient<paths>({
    baseUrl,
    fetch: authorizedFetch(fetchFn, credential, { "Accept-Language": language }),
  });
}

/** Unwraps `ResultResponse.result`; a non-zero `error_code` becomes ItmoApiError. */
export async function result<D extends { error_code?: number | null; error_message?: string | null; result?: unknown }>(
  operation: string,
  request: Promise<Fetched<D>>,
): Promise<D["result"]> {
  const body = await settle("my.itmo.ru", operation, request);
  if (body.error_code) {
    throw new ItmoApiError("my.itmo.ru", operation, 200, body.error_code, body.error_message ?? undefined);
  }
  return body.result;
}

/** Unwraps the legacy schedule `DataResponse.data`; a non-zero `code` becomes ItmoApiError. */
export async function data<D extends { code: number; message?: string | null; data?: unknown }>(
  operation: string,
  request: Promise<Fetched<D>>,
): Promise<D["data"]> {
  const body = await settle("my.itmo.ru", operation, request);
  if (body.code !== 0) throw new ItmoApiError("my.itmo.ru", operation, 200, body.code, body.message ?? undefined);
  return body.data;
}
