import { CredentialRejectedError } from "../auth/errors.js";
import { isuFromAccessToken, type ItmoIdClient, MY_ITMO_CLIENT } from "../auth/itmo-id.js";
import { currentPlatform } from "../auth/session-label.js";
import type { Connection, StateStore } from "../auth/state-store.js";
import { VERSION } from "../version.js";
import { WidgetsApiError, type CreatedChallenge, type PairingClaim, type WidgetsClient } from "./client.js";
import { type PairingBundle, type PairingKind, PairingTarget } from "./crypto.js";

/** Shows the pairing in the terminal. */
export interface PairingView {
  link(link: string, expiresAt: string): void;
  /** The phone opened the link: the verification code to compare with the phone's screen. */
  opened(verificationCode: string): void;
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

/** `pair`: a new `mcp` connection with its own ITMO.ID session, signed in on the phone. */
export async function pair(deps: Pairing, options: { name: string; scopes?: string[] }): Promise<Connection> {
  if ((await deps.store.read()).connection) {
    throw new PairingError("Уже подключено: `itmo-mcp renew` обновит вход в ИТМО, `itmo-mcp unpair` отключит");
  }
  const target = await PairingTarget.create();
  const challenge = await deps.widgets.createChallenge({
    keyCommitment: target.keyCommitment(),
    name: options.name,
    version: VERSION,
    platform: currentPlatform(),
    scopes: options.scopes,
  });
  const claim = await waitForClaim(deps, target, challenge);
  if (!claim.token?.startsWith("iwc_") || !claim.connection) throw new PairingError("Сервер не выдал токен подключения");
  const widgets = deps.widgets.withToken(claim.token);
  try {
    const bundle = await openBundle(deps, target, challenge, claim, "CONNECT");
    const me = await widgets.me();
    const refreshToken = await checkSession(deps, bundle, me.isu);
    const connection: Connection = {
      token: claim.token,
      id: claim.connection.id,
      name: claim.connection.name,
      isu: bundle.isu,
      itmo: sessionOf(bundle),
    };
    await deps.store.update({ refreshToken, connection });
    await widgets.reportStatus("ok").catch(() => undefined);
    return connection;
  } catch (error) {
    await widgets.revokeSelf().catch(() => undefined);
    throw error;
  }
}

/** `renew`: a new ITMO.ID session for the stored connection; the old one is ended once the new one works. */
export async function renew(deps: Pairing): Promise<Connection> {
  const state = await deps.store.read();
  const current = state.connection;
  if (!current) throw new PairingError("Не подключено: сначала `itmo-mcp pair`");
  const widgets = deps.widgets.withToken(current.token);
  const target = await PairingTarget.create();
  const challenge = await widgets.renew(target.keyCommitment());
  const claim = await waitForClaim(deps, target, challenge);
  const bundle = await openBundle(deps, target, challenge, claim, "RENEW");
  const refreshToken = await checkSession(deps, bundle, current.isu);
  const connection: Connection = { ...current, itmo: sessionOf(bundle) };
  await deps.store.update({ refreshToken, connection });
  if (state.refreshToken && current.itmo.sid !== bundle.itmo.sid) {
    await deps.idClient.logout(MY_ITMO_CLIENT, state.refreshToken).catch(() => undefined);
  }
  await widgets.reportStatus("ok").catch(() => undefined);
  return connection;
}

/**
 * Ends this server's own ITMO.ID session (OIDC logout with its refresh token) and forgets the connection and the
 * session. Env credentials are kept. Returns false when nothing was paired.
 */
export async function forgetConnection(store: StateStore, idClient: ItmoIdClient): Promise<boolean> {
  const state = await store.read();
  if (!state.connection) return false;
  if (state.refreshToken) await idClient.logout(MY_ITMO_CLIENT, state.refreshToken).catch(() => undefined);
  await store.update({ connection: undefined, refreshToken: undefined });
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
      deps.view.opened(target.verificationCode(challenge.challengeId));
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
  if (!claim.sealedBundle) throw new PairingError("Телефон не передал вход в ИТМО");
  return target.open(claim.sealedBundle, challenge.challengeId, kind, (deps.now ?? (() => new Date()))());
}

/**
 * Refreshes the handed-over token once (the canary) and checks that the session is the connection owner's.
 * A session of another account is ended at once. Returns the rotated refresh token.
 */
async function checkSession(deps: Pairing, bundle: PairingBundle, ownerIsu: number): Promise<string> {
  let tokens;
  try {
    tokens = await deps.idClient.refresh(MY_ITMO_CLIENT, bundle.itmo.refreshToken);
  } catch (error) {
    if (error instanceof CredentialRejectedError) throw new PairingError("ИТМО не принял новый вход: подключите ещё раз");
    throw error;
  }
  const refreshToken = tokens.refreshToken || bundle.itmo.refreshToken;
  if (bundle.isu !== ownerIsu || isuFromAccessToken(tokens.accessToken) !== ownerIsu) {
    await deps.idClient.logout(MY_ITMO_CLIENT, refreshToken).catch(() => undefined);
    throw new PairingError("Это другой аккаунт ITMO: войдите на телефоне в свой аккаунт и подключите заново");
  }
  return refreshToken;
}

function sessionOf(bundle: PairingBundle): Connection["itmo"] {
  const { sid, expiresAt, refreshExpiresAt } = bundle.itmo;
  return { sid, expiresAt, refreshExpiresAt, status: "ok" };
}
