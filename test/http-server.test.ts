import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createBarsClient } from "../src/clients/bars.js";
import { createMyItmoClient } from "../src/clients/my-itmo.js";
import { createHttpServer } from "../src/http-server.js";
import { json, stubFetch } from "./support/fetch.js";

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(options: { token?: string; allowedHosts?: string[] } = {}) {
  const fetchFn = stubFetch(() => json({ error_code: 0, result: { id: 1, status: "open" } }));
  const deps = {
    my: createMyItmoClient({ tokens: { accessToken: async () => "t", forceRefresh: async () => "t" }, fetchFn }),
    bars: createBarsClient({ session: { authorization: async () => "Bearer b", invalidate: () => undefined }, fetchFn }),
    isu: async () => 1,
    now: () => new Date(),
  };
  const server = createHttpServer(deps, { allowedHosts: options.allowedHosts ?? [], token: options.token });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const rpc = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
  body: JSON.stringify(body),
});

const callTool = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "itmo_get_election_status", arguments: {} } };

describe("createHttpServer", () => {
  it("answers health checks and 404s unknown paths", async () => {
    const base = await start({ token: "secret" });

    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });

  it("requires the bearer token when configured", async () => {
    const base = await start({ token: "secret" });

    expect((await fetch(`${base}/mcp`, rpc(callTool))).status).toBe(401);
    expect((await fetch(`${base}/mcp`, rpc(callTool, { Authorization: "Bearer wrong!" }))).status).toBe(401);
    const res = await fetch(`${base}/mcp`, rpc(callTool, { Authorization: "Bearer secret" }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('\\"status\\":\\"open\\"');
  });

  it("rejects GET because the endpoint is stateless", async () => {
    const base = await start();

    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });

  it("rejects unexpected Host headers when allowed hosts are configured", async () => {
    const base = await start({ allowedHosts: ["mcp.example.com"] });

    expect((await fetch(`${base}/mcp`, rpc(callTool))).status).toBe(403);
  });
});
