import { CredentialRejectedError } from "../auth/errors.js";
import { holdsPairedCookie, ITMO_REFRESH_GRANT, ITMO_SSO_GRANT, pairedCookie } from "../auth/grants.js";
import { isuFromAccessToken, type ItmoIdClient, MY_ITMO_CLIENT } from "../auth/itmo-id.js";
import { endSession, SessionMismatchError, tokensFromCookie } from "../auth/paired-session.js";
import { currentPlatform } from "../auth/session-label.js";
import type { Connection, StateStore } from "../auth/state-store.js";
import { VERSION } from "../version.js";
import {
  type CreatedChallenge,
  type GrantRequest,
  type PairingClaim,
  WidgetsApiError,
  type WidgetsClient,
} from "./client.js";
import { type ItmoSession, type PairingBundle, type PairingKind, PairingTarget } from "./crypto.js";

/** Shows the pairing in the terminal. */
export interface PairingView {
  link(link: string, expiresAt: string): void;
  /** The phone opened the link; the rest happens there. */
  opened(): void;
}

export interface Pairing {
  /** Anonymous; `renew` adds the stored connection token itself. */
  widgets: WidgetsClient;
  idClient: ItmoIdClient;
  store: StateStore;
  /** Origin of the pairing link, e.g. https://widgets.alllexey.dev. */
  origin: string;
  view: PairingView;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/** A user-facing pairing failure; the message is Russian copy for the terminal. */
export class PairingError extends Error {
  override readonly name = "PairingError";
}

const POLL_MS = 2_000;
const MAX_WAIT_MS = 15 * 60_000;

/** Widgets scopes `pair --itmo-cookie` asks for when `--scopes` is not given (the registry's defaults). */
export const DEFAULT_SCOPES = ["reviews:read", "links:read"];

/** ITMO grants of protocol 2: the refresh token and the cookie, both optional; the user picks on the phone. */
export const ITMO_GRANTS: GrantRequest[] = [{ id: ITMO_REFRESH_GRANT }, { id: ITMO_SSO_GRANT }];

/** The protocol 2 request of `pair --itmo-cookie`: `--scopes` as `widgets:*`, then the ITMO grants; none required. */
export function connectGrants(scopes: string[] = DEFAULT_SCOPES): GrantRequest[] {
  const widgets = scopes.map((scope) => `widgets:${scope.replace(/^widgets:/, "")}`);
  return [...new Set(widgets)].map((id) => ({ id })).concat(ITMO_GRANTS);
}

export interface PairOptions {
  name: string;
  scopes?: string[];
  /** Protocol 2: also ask for the ITMO.ID cookie (`itmo:sso`) and let the phone choose every grant. */
  itmoCookie?: boolean;
}

/** `pair`: a new `mcp` connection with its own ITMO.ID session, signed in on the phone. */
export async function pair(deps: Pairing, options: PairOptions): Promise<Connection> {
  if ((await deps.store.read()).connection) {
    throw new PairingError("Уже подключено: `itmo-mcp renew` обновит вход в ИТМО, `itmo-mcp unpair` отключит");
  }
  const target = await PairingTarget.create();
  const challenge = await deps.widgets.createChallenge({
    keyCommitment: target.keyCommitment(),
    name: options.name,
    version: VERSION,
    platform: currentPlatform(),
    ...(options.itmoCookie ? { grants: connectGrants(options.scopes) } : { scopes: options.scopes }),
  });
  const claim = await waitForClaim(deps, target, challenge);
  if (!claim.token?.startsWith("iwc_") || !claim.connection) throw new PairingError("Сервер не выдал токен подключения");
  const widgets = deps.widgets.withToken(claim.token);
  try {
    // Protocol 2 without any ITMO grant has no bundle: the connection is for widgets_* tools only.
    const bundle = claim.sealedBundle || !options.itmoCookie ? await openBundle(deps, target, challenge, claim, "CONNECT") : undefined;
    const me = await widgets.me();
    const session = bundle?.itmo ? await checkSession(deps, bundle, bundle.itmo, me.isu) : undefined;
    if (bundle && bundle.isu !== me.isu) throw new PairingError(OTHER_ACCOUNT);
    const connection: Connection = {
      token: claim.token,
      id: claim.connection.id,
      name: claim.connection.name,
      isu: me.isu,
      ...(bundle?.v === 2 || !bundle ? { itmoGrants: bundle?.itmo?.grants ?? [] } : {}),
      ...(bundle?.itmo ? { itmo: sessionOf(bundle.itmo) } : {}),
    };
    await deps.store.update({
      refreshToken: session?.refreshToken,
      connection,
      ...(session?.keycloakIdentity ? { keycloakIdentity: session.keycloakIdentity } : {}),
    });
    await widgets.reportStatus(session ? "ok" : "none").catch(() => undefined);
    return connection;
  } catch (error) {
    await widgets.revokeSelf().catch(() => undefined);
    throw error;
  }
}

/**
 * `renew`: a new ITMO.ID session for the stored connection; the old one is ended once the new one works. With
 * `itmoCookie` it asks (protocol 2) for the refresh token and the cookie; without, Backend asks for the grants the
 * connection holds.
 */
export async function renew(deps: Pairing, options: { itmoCookie?: boolean } = {}): Promise<Connection> {
  const state = await deps.store.read();
  const current = state.connection;
  if (!current) throw new PairingError("Не подключено: сначала `itmo-mcp pair`");
  const widgets = deps.widgets.withToken(current.token);
  const target = await PairingTarget.create();
  const challenge = await widgets.renew(target.keyCommitment(), options.itmoCookie ? ITMO_GRANTS : undefined);
  const claim = await waitForClaim(deps, target, challenge);
  const bundle = await openBundle(deps, target, challenge, claim, "RENEW");
  if (!bundle.itmo) throw new PairingError(NO_SESSION);
  const session = await checkSession(deps, bundle, bundle.itmo, current.isu);
  const connection: Connection = {
    ...current,
    ...(bundle.v === 2 ? { itmoGrants: bundle.itmo.grants } : { itmoGrants: undefined }),
    itmo: sessionOf(bundle.itmo),
  };
  const oldCookie = pairedCookie(state);
  await deps.store.update({
    refreshToken: session.refreshToken,
    connection,
    // the old session's cookie ends with it; a rotated env cookie stays
    ...(session.keycloakIdentity || oldCookie ? { keycloakIdentity: session.keycloakIdentity } : {}),
  });
  if (current.itmo && current.itmo.sid !== bundle.itmo.sid) {
    await endSession(deps.idClient, { refreshToken: state.refreshToken, keycloakIdentity: oldCookie });
  }
  await widgets.reportStatus("ok").catch(() => undefined);
  return connection;
}

/**
 * Ends this server's own ITMO.ID session (OIDC logout with its refresh token, or one minted from its cookie) and
 * forgets the connection and the session's credentials. Env credentials are kept. Returns false when nothing was
 * paired.
 */
export async function forgetConnection(store: StateStore, idClient: ItmoIdClient): Promise<boolean> {
  const state = await store.read();
  if (!state.connection) return false;
  const cookie = pairedCookie(state);
  await endSession(idClient, { refreshToken: state.refreshToken, keycloakIdentity: cookie });
  await store.update({
    connection: undefined,
    refreshToken: undefined,
    ...(holdsPairedCookie(state.connection) ? { keycloakIdentity: undefined } : {}),
  });
  return true;
}

async function waitForClaim(deps: Pairing, target: PairingTarget, challenge: CreatedChallenge): Promise<PairingClaim> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  deps.view.link(target.link(deps.origin, challenge.code), challenge.expiresAt);
  const deadline = now().getTime() + MAX_WAIT_MS;
  let shown = false;
  while (now().getTime() < deadline) {
    await sleep(POLL_MS);
    let claim: PairingClaim;
    try {
      claim = await deps.widgets.claim(challenge.challengeId, challenge.claimSecret);
    } catch (error) {
      if (error instanceof WidgetsApiError && error.status === 404) {
        throw new PairingError("Время подключения истекло: запустите команду ещё раз");
      }
      if (error instanceof WidgetsApiError && error.status !== 429 && error.status < 500) throw error;
      continue; // rate limit, server or network trouble: keep polling
    }
    if (claim.status === "OPENED" && !shown) {
      deps.view.opened();
      shown = true;
    }
    if (claim.status === "CLAIMED") return claim;
  }
  throw new PairingError("Время подключения истекло: запустите команду ещё раз");
}

function openBundle(
  deps: Pairing,
  target: PairingTarget,
  challenge: CreatedChallenge,
  claim: PairingClaim,
  kind: PairingKind,
): Promise<PairingBundle> {
  if (!claim.sealedBundle) throw new PairingError(NO_SESSION);
  return target.open(claim.sealedBundle, challenge.challengeId, kind, (deps.now ?? (() => new Date()))());
}

const NO_SESSION = "Телефон не передал вход в ИТМО";
const OTHER_ACCOUNT = "Это другой аккаунт ITMO: войдите на телефоне в свой аккаунт и подключите заново";
const REFUSED = "ИТМО не принял новый вход: подключите ещё раз";

/**
 * Checks that the handed-over session works and is the connection owner's: the refresh token is refreshed once
 * (the canary), the cookie signs in silently once and its tokens must carry the bundle's `sid` and the owner's ISU.
 * On any failure every session this check reached is ended. Returns the credentials to keep: the rotated refresh
 * token (or, with the cookie only, the one minted from it) and the cookie as ITMO.ID left it.
 */
async function checkSession(
  deps: Pairing,
  bundle: PairingBundle,
  itmo: ItmoSession,
  ownerIsu: number,
): Promise<{ refreshToken: string; keycloakIdentity?: string }> {
  const reached: string[] = [];
  const fail = async (message: string): Promise<never> => {
    for (const token of reached) await deps.idClient.logout(MY_ITMO_CLIENT, token).catch(() => undefined);
    throw new PairingError(message);
  };
  let refreshToken: string | undefined;
  let keycloakIdentity: string | undefined;
  try {
    if (itmo.refreshToken) {
      const tokens = await deps.idClient.refresh(MY_ITMO_CLIENT, itmo.refreshToken);
      refreshToken = tokens.refreshToken || itmo.refreshToken;
      reached.push(refreshToken);
      if (bundle.isu !== ownerIsu || isuFromAccessToken(tokens.accessToken) !== ownerIsu) return await fail(OTHER_ACCOUNT);
    }
    if (itmo.keycloakIdentity) {
      if (bundle.isu !== ownerIsu) {
        await endSession(deps.idClient, { keycloakIdentity: itmo.keycloakIdentity });
        return await fail(OTHER_ACCOUNT);
      }
      const minted = await tokensFromCookie(deps.idClient, itmo.keycloakIdentity, { sid: itmo.sid, isu: ownerIsu });
      keycloakIdentity = minted.keycloakIdentity;
      if (minted.tokens.refreshToken) reached.push(minted.tokens.refreshToken);
      refreshToken ??= minted.tokens.refreshToken || undefined;
    }
  } catch (error) {
    if (error instanceof PairingError) throw error; // sessions already ended
    if (error instanceof SessionMismatchError) {
      return await fail(error.mismatch === "isu" ? OTHER_ACCOUNT : "Полный доступ к ITMO.ID не от этого входа: подключите ещё раз");
    }
    if (error instanceof CredentialRejectedError) return await fail(REFUSED);
    for (const token of reached) await deps.idClient.logout(MY_ITMO_CLIENT, token).catch(() => undefined);
    throw error;
  }
  if (!refreshToken) return await fail(REFUSED);
  return { refreshToken, keycloakIdentity };
}

function sessionOf(itmo: ItmoSession): NonNullable<Connection["itmo"]> {
  const { sid, expiresAt, refreshExpiresAt } = itmo;
  return { sid, expiresAt, ...(refreshExpiresAt ? { refreshExpiresAt } : {}), status: "ok" };
}
