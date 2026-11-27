import { createHash, randomBytes } from "node:crypto";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { ITMO_REFRESH_GRANT, ITMO_SSO_GRANT, KNOWN_ITMO_GRANTS } from "../auth/grants.js";

/**
 * The client side of ITMO.Widgets pairing (Backend `docs/contracts/connections.md`, the same bytes as the app's
 * `PairingCrypto` and the agent's `internal/pair`): an ephemeral X25519 key `pk`/`sk` and a 16-byte secret `s`
 * that exist only in memory and in the link fragment.
 */

export type PairingKind = "CONNECT" | "RENEW";

/** This client's id in the ITMO.Widgets client registry (protocol 2). */
export const CLIENT_ID = "itmo-mcp";

/**
 * What the phone sealed for this client, v1 or v2 read into one shape. Secret, never logged.
 * `itmo` is absent when the phone sealed no ITMO grant this version knows.
 */
export interface PairingBundle {
  v: 1 | 2;
  challengeId: string;
  kind: PairingKind;
  isu: number;
  issuedAt: string;
  itmo?: ItmoSession;
}

/** The fresh ITMO.ID session the phone signed in for this client and the credentials it granted from it. */
export interface ItmoSession {
  sid: string;
  expiresAt: string;
  /** The known ITMO grants that came, in the phone's order. */
  grants: string[];
  /** `itmo:refresh:student-personal-cabinet` (always present in v1). */
  refreshToken?: string;
  refreshExpiresAt?: string;
  /** `itmo:sso`: the session's KEYCLOAK_IDENTITY. */
  keycloakIdentity?: string;
  keycloakIdentityExpiresAt?: string;
}

export class BundleError extends Error {
  override readonly name = "BundleError";
  constructor(detail = "") {
    super(`The sealed ITMO session does not match this pairing${detail}`);
  }
}

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

const MAX_BUNDLE_AGE_MS = 15 * 60_000;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const sha256 = (...parts: (string | Uint8Array)[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};

function uuidBytes(id: string): Buffer {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("The challenge id is not a UUID");
  }
  return Buffer.from(id.replaceAll("-", ""), "hex");
}

/** `"itmo-widgets pair v1" || 0x00 || challengeId || kind || 0x00 || s`: binds a ciphertext to one challenge. */
export function pairingInfo(challengeId: string, kind: PairingKind, secret: Uint8Array): Buffer {
  const zero = Buffer.of(0);
  return Buffer.concat([Buffer.from("itmo-widgets pair v1"), zero, uuidBytes(challengeId), Buffer.from(kind), zero, secret]);
}

export class PairingTarget {
  private constructor(
    private readonly privateKey: CryptoKey,
    readonly publicKey: Uint8Array,
    readonly secret: Uint8Array,
  ) {}

  static async create(): Promise<PairingTarget> {
    const pair = await suite.kem.generateKeyPair();
    const publicKey = new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey));
    return new PairingTarget(pair.privateKey, publicKey, randomBytes(16));
  }

  /** For tests: a fixed raw X25519 private key. */
  static async fromRaw(privateKey: Uint8Array, publicKey: Uint8Array, secret: Uint8Array): Promise<PairingTarget> {
    return new PairingTarget(await suite.kem.importKey("raw", copy(privateKey), false), publicKey, secret);
  }

  /** `SHA-256("iw-pair-commit-v1" || pk || s)`, base64url: the only part of the link Backend sees. */
  keyCommitment(): string {
    return b64(sha256("iw-pair-commit-v1", this.publicKey, this.secret));
  }

  /** `https://<host>/pair#v1.<CODE>.<pk>.<s>`; the fragment never reaches a server. */
  link(origin: string, code: string): string {
    return `${origin}/pair#v1.${code}.${b64(this.publicKey)}.${b64(this.secret)}`;
  }

  /** Opens `enc || ciphertext` (base64url) and checks that the bundle belongs to this challenge and is fresh. */
  async open(sealed: string, challengeId: string, kind: PairingKind, now: Date): Promise<PairingBundle> {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 48 || raw.length > 16 * 1024) throw new BundleError();
    let plain: ArrayBuffer;
    try {
      plain = await suite.open(
        { recipientKey: this.privateKey, enc: copy(raw.subarray(0, 32)), info: copy(pairingInfo(challengeId, kind, this.secret)) },
        copy(raw.subarray(32)),
      );
    } catch {
      throw new BundleError();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(plain).toString("utf8"));
    } catch {
      throw new BundleError();
    }
    const bundle = readBundle(parsed, challengeId, kind);
    if (!bundle) throw new BundleError();
    const age = now.getTime() - Date.parse(bundle.issuedAt);
    if (!(Math.abs(age) <= MAX_BUNDLE_AGE_MS)) throw new BundleError(": issued too long ago");
    return bundle;
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isInstant = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isSecret = (value: unknown): value is string => typeof value === "string" && value !== "";

/** Checks a decrypted bundle against the challenge; undefined when anything is off. */
function readBundle(raw: unknown, challengeId: string, kind: PairingKind): PairingBundle | undefined {
  if (!isObject(raw)) return undefined;
  const header =
    typeof raw.challengeId === "string" &&
    raw.challengeId.toLowerCase() === challengeId.toLowerCase() &&
    raw.kind === kind &&
    Number.isSafeInteger(raw.isu) &&
    (raw.isu as number) > 0;
  if (!header) return undefined;
  const base = { challengeId: raw.challengeId as string, kind, isu: raw.isu as number, issuedAt: raw.issuedAt as string };
  if (raw.v === 1) {
    const itmo = raw.itmo;
    if (!isObject(itmo) || !isSecret(itmo.refreshToken) || typeof itmo.sid !== "string") return undefined;
    return {
      ...base,
      v: 1,
      itmo: {
        sid: itmo.sid,
        expiresAt: itmo.expiresAt as string,
        grants: [ITMO_REFRESH_GRANT],
        refreshToken: itmo.refreshToken,
        refreshExpiresAt: typeof itmo.refreshExpiresAt === "string" ? itmo.refreshExpiresAt : undefined,
      },
    };
  }
  if (raw.v !== 2 || raw.clientId !== CLIENT_ID || !isInstant(raw.issuedAt)) return undefined;
  if (raw.itmo === undefined || raw.itmo === null) return { ...base, v: 2 };
  const itmo = readSession(raw.itmo);
  if (itmo === null) return undefined;
  return { ...base, v: 2, ...(itmo ? { itmo } : {}) };
}

/** v2 `itmo`: null when malformed, undefined when it holds no grant this version knows. */
function readSession(raw: unknown): ItmoSession | null | undefined {
  if (!isObject(raw) || !isSecret(raw.sid) || !isInstant(raw.expiresAt) || !Array.isArray(raw.items)) return null;
  const session: ItmoSession = { sid: raw.sid, expiresAt: raw.expiresAt, grants: [] };
  for (const item of raw.items) {
    if (!isObject(item) || typeof item.grant !== "string") return null;
    if (!KNOWN_ITMO_GRANTS.includes(item.grant)) continue; // granted by a newer app: not for this version
    if (session.grants.includes(item.grant) || !isSecret(item.value) || !isInstant(item.expiresAt)) return null;
    session.grants.push(item.grant);
    if (item.grant === ITMO_REFRESH_GRANT) {
      session.refreshToken = item.value;
      session.refreshExpiresAt = item.expiresAt;
    } else if (item.grant === ITMO_SSO_GRANT) {
      session.keycloakIdentity = item.value;
      session.keycloakIdentityExpiresAt = item.expiresAt;
    }
  }
  return session.grants.length > 0 ? session : undefined;
}

function copy(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
