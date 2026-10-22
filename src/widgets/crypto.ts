import { createHash, randomBytes } from "node:crypto";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";

/**
 * The client side of ITMO.Widgets pairing (Backend `docs/contracts/connections.md`, the same bytes as the app's
 * `PairingCrypto` and the agent's `internal/pair`): an ephemeral X25519 key `pk`/`sk` and a 16-byte secret `s`
 * that exist only in memory and in the link fragment.
 */

export type PairingKind = "CONNECT" | "RENEW";

/** What the phone seals for this client: a fresh ITMO.ID session of its own. Secret, never logged. */
export interface PairingBundle {
  v: 1;
  challengeId: string;
  kind: PairingKind;
  isu: number;
  issuedAt: string;
  itmo: { sid: string; expiresAt: string; refreshToken: string; refreshExpiresAt?: string };
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

  /** Six digits shown on both screens: the first 20 bits of `SHA-256("iw-pair-sas-v1" || id || pk || s)` mod 10^6. */
  verificationCode(challengeId: string): string {
    const d = sha256("iw-pair-sas-v1", uuidBytes(challengeId), this.publicKey, this.secret);
    const digits = String((((d[0]! << 12) | (d[1]! << 4) | (d[2]! >> 4)) >>> 0) % 1_000_000).padStart(6, "0");
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
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
    let bundle: PairingBundle;
    try {
      bundle = JSON.parse(Buffer.from(plain).toString("utf8")) as PairingBundle;
    } catch {
      throw new BundleError();
    }
    const valid =
      bundle.v === 1 &&
      bundle.challengeId?.toLowerCase() === challengeId.toLowerCase() &&
      bundle.kind === kind &&
      Number.isSafeInteger(bundle.isu) &&
      bundle.isu > 0 &&
      typeof bundle.itmo?.refreshToken === "string" &&
      bundle.itmo.refreshToken !== "" &&
      typeof bundle.itmo.sid === "string";
    if (!valid) throw new BundleError();
    const age = now.getTime() - Date.parse(bundle.issuedAt);
    if (!(Math.abs(age) <= MAX_BUNDLE_AGE_MS)) throw new BundleError(": issued too long ago");
    return bundle;
  }
}

function copy(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
