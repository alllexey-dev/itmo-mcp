/** An ITMO service answered with an error; the message is safe to show and never contains credentials. */
export class ItmoApiError extends Error {
  override readonly name = "ItmoApiError";

  constructor(
    readonly service: string,
    readonly operation: string,
    readonly status: number,
    readonly code?: number,
    readonly serverMessage?: string,
  ) {
    const details = [`HTTP ${status}`, code === undefined ? undefined : `code ${code}`, serverMessage]
      .filter(Boolean)
      .join(", ");
    super(`${service} ${operation} failed: ${details}`);
  }
}

export interface Fetched<D> {
  data?: D;
  error?: unknown;
  response: Response;
}

/** Awaits an openapi-fetch call, turning transport failures and HTTP errors into ItmoApiError. */
export async function settle<D>(service: string, operation: string, request: Promise<Fetched<D>>): Promise<D> {
  let fetched: Fetched<D>;
  try {
    fetched = await request;
  } catch (error) {
    if (error instanceof SyntaxError) throw new ItmoApiError(service, operation, 200, undefined, "response is not JSON");
    throw error;
  }
  const { data, error, response } = fetched;
  if (!response.ok || data === undefined) {
    throw new ItmoApiError(service, operation, response.status, errorCode(error), errorMessage(error));
  }
  return data;
}

function errorCode(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>).error_code ?? (body as Record<string, unknown>).code;
  return typeof value === "number" ? value : undefined;
}

function errorMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body.trimStart().startsWith("<") ? undefined : body.slice(0, 200);
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const value = record.error_message ?? record.message ?? record.error;
  return typeof value === "string" ? value.slice(0, 200) : undefined;
}
