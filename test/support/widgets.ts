import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { pairingInfo, type PairingKind } from "../../src/widgets/crypto.js";
import { accessToken, json } from "./fetch.js";

export const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** What the phone does with a scanned link: seals `bundle` to its key with the challenge's info. */
export async function sealForLink(link: string, challengeId: string, kind: PairingKind, bundle: unknown): Promise<string> {
  const [, , pk, s] = new URL(link).hash.slice(1).split(".");
  const recipientPublicKey = await suite.kem.deserializePublicKey(buffer(Buffer.from(pk!, "base64url")));
  const info = pairingInfo(challengeId, kind, Buffer.from(s!, "base64url"));
  const { enc, ct } = await suite.seal(
    { recipientPublicKey, info: buffer(info) },
    buffer(Buffer.from(JSON.stringify(bundle))),
  );
  return Buffer.concat([Buffer.from(enc), Buffer.from(ct)]).toString("base64url");
}

export const ok = (data: unknown, status = 200) => json({ success: true, data, error: null }, status);
export const fail = (status: number, code: string) => json({ success: false, data: null, error: { code, message: code } }, status);

export const ISU = 123456;
export const otherAccountToken = () => accessToken(999999);
