import createClient, { type Client } from "openapi-fetch";
import { BARS_REST_URL, type BarsSession } from "../auth/bars-session.js";
import type { paths } from "../generated/bars.js";
import { authorizedFetch, type FetchFn } from "../http.js";
import { type Fetched, settle } from "./errors.js";

export type BarsClient = Client<paths>;

export interface BarsClientOptions {
  session: Pick<BarsSession, "authorization" | "invalidate">;
  fetchFn?: FetchFn;
  baseUrl?: string;
}

export function createBarsClient({ session, fetchFn = fetch, baseUrl = BARS_REST_URL }: BarsClientOptions): BarsClient {
  const credential = {
    current: () => session.authorization(),
    rejected: async (value: string) => {
      session.invalidate(value);
      return session.authorization();
    },
  };
  return createClient<paths>({ baseUrl, fetch: authorizedFetch(fetchFn, credential) });
}

export function bars<D>(operation: string, request: Promise<Fetched<D>>): Promise<D> {
  return settle("bars.itmo.ru", operation, request);
}
