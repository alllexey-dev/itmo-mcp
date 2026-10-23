import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthError, CredentialRejectedError } from "../../src/auth/errors.js";
import {
  BARS_CLIENT,
  isuFromAccessToken,
  ItmoIdClient,
  MY_ITMO_CLIENT,
  pkcePair,
} from "../../src/auth/itmo-id.js";
import { accessToken, html, json, redirect, stubFetch } from "../support/fetch.js";
import { callback, invalidGrant, isAuthorize, tokenResponse } from "../support/itmo-id.js";

const LOGIN_PAGE = `<script>const kcContext = { "loginAction": "https://id.itmo.ru/login-actions/authenticate" }</script>`;

describe("pkcePair", () => {
  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = pkcePair();

    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("ItmoIdClient.codeWithIdentity", () => {
  it("sends the SSO cookie, returns the code with PKCE verifier and the rotated cookie", async () => {
    const fetchFn = stubFetch((call) => callback(call, "c1", ["KEYCLOAK_IDENTITY=rotated; Path=/; HttpOnly"]));

    const result = await new ItmoIdClient(fetchFn).codeWithIdentity(MY_ITMO_CLIENT, "old");

    const call = fetchFn.calls[0]!;
    expect(call.headers.get("cookie")).toBe("KEYCLOAK_IDENTITY=old");
    expect(call.url.searchParams.get("client_id")).toBe("student-personal-cabinet");
    expect(call.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(result).toMatchObject({ code: "c1", keycloakIdentity: "rotated" });
    expect(result.verifier).toBeTruthy();
  });

  it("omits PKCE for BARS", async () => {
    const fetchFn = stubFetch((call) => callback(call));

    const result = await new ItmoIdClient(fetchFn).codeWithIdentity(BARS_CLIENT, "id");

    expect(fetchFn.calls[0]!.url.searchParams.has("code_challenge")).toBe(false);
    expect(result.verifier).toBeUndefined();
    expect(result.keycloakIdentity).toBe("id");
  });

  it("rejects an expired session that lands on the login page", async () => {
    const fetchFn = stubFetch(() => html(LOGIN_PAGE));

    await expect(new ItmoIdClient(fetchFn).codeWithIdentity(MY_ITMO_CLIENT, "expired")).rejects.toBeInstanceOf(
      CredentialRejectedError,
    );
  });

  it("rejects a redirect with a mismatched state", async () => {
    const fetchFn = stubFetch(() => redirect("https://my.itmo.ru/login/callback?state=evil&code=c"));

    await expect(new ItmoIdClient(fetchFn).codeWithIdentity(MY_ITMO_CLIENT, "id")).rejects.toThrow(/state/);
  });

  it("surfaces an OAuth error from the callback", async () => {
    const fetchFn = stubFetch(() => redirect("https://my.itmo.ru/login/callback?error=access_denied"));

    await expect(new ItmoIdClient(fetchFn).codeWithIdentity(MY_ITMO_CLIENT, "id")).rejects.toThrow(AuthError);
  });
});

describe("ItmoIdClient.logout", () => {
  it("ends the session of a refresh token with the my.itmo.ru client", async () => {
    const fetchFn = stubFetch(() => new Response(null, { status: 204 }));

    await new ItmoIdClient(fetchFn, undefined, undefined, "test-agent").logout(MY_ITMO_CLIENT, "refresh-1");

    const call = fetchFn.calls[0]!;
    expect(`${call.method} ${call.url.pathname}`).toBe("POST /auth/realms/itmo/protocol/openid-connect/logout");
    expect(Object.fromEntries(new URLSearchParams(call.body))).toEqual({
      client_id: "student-personal-cabinet",
      refresh_token: "refresh-1",
    });
    expect(call.headers.get("user-agent")).toBe("test-agent");
  });

  it("fails on an error answer", async () => {
    const fetchFn = stubFetch(() => json({ error: "invalid_grant" }, 400));

    await expect(new ItmoIdClient(fetchFn).logout(MY_ITMO_CLIENT, "r")).rejects.toThrow(/logout failed \(HTTP 400\)/);
  });
});

describe("ItmoIdClient token requests", () => {
  it("exchanges a code with the PKCE verifier", async () => {
    const fetchFn = stubFetch(() => tokenResponse("r1"));

    const tokens = await new ItmoIdClient(fetchFn, undefined, () => 1000).exchangeCode(MY_ITMO_CLIENT, {
      code: "c",
      verifier: "v",
    });

    const form = new URLSearchParams(fetchFn.calls[0]!.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code_verifier")).toBe("v");
    expect(tokens).toMatchObject({ refreshToken: "r1", expiresAt: 1000 + 1800 * 1000 });
  });

  it("maps invalid_grant on refresh to CredentialRejectedError", async () => {
    const fetchFn = stubFetch(invalidGrant);

    await expect(new ItmoIdClient(fetchFn).refresh(MY_ITMO_CLIENT, "old")).rejects.toBeInstanceOf(
      CredentialRejectedError,
    );
  });

  it("maps other token errors to AuthError", async () => {
    const fetchFn = stubFetch(() => json({}, 502));

    const error = await new ItmoIdClient(fetchFn).refresh(MY_ITMO_CLIENT, "old").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).not.toBeInstanceOf(CredentialRejectedError);
  });
});

describe("isuFromAccessToken", () => {
  it("reads the isu claim", () => {
    expect(isuFromAccessToken(accessToken(502000))).toBe(502000);
  });

  it("returns undefined for malformed tokens", () => {
    expect(isuFromAccessToken("garbage")).toBeUndefined();
  });
});
