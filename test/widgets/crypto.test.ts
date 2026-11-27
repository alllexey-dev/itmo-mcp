import { describe, expect, it } from "vitest";
import { BundleError, pairingInfo, PairingTarget } from "../../src/widgets/crypto.js";
import { sealForLink, suite } from "../support/widgets.js";

// The app's PairingVectors (ITMO.Widgets shared/feature-account): RFC 9180 A.2 recipient key, secret 0..15.
const PUBLIC_KEY = Buffer.from("4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a", "hex");
const PRIVATE_KEY = Buffer.from("8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb", "hex");
const SECRET = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
const CHALLENGE_ID = "0190f1a2-3b4c-7d5e-8f60-718293a4b5c6";
const INFO_HEX =
  "69746d6f2d776964676574732070616972207631000190f1a23b4c7d5e8f60718293a4b5c6" +
  "4147454e5400000102030405060708090a0b0c0d0e0f";
const SEALED_BY_CRYPTOKIT =
  "37YNlQqG71GoLEYtoCh_O3y1qIBGc44a1vRHTqjGlTyg2deA_vKEogu87KlNSEgK72MQCOG2pjrOoJ4N" +
  "YdnRYlyR2t40KcQ2Kiiv54uSoagvJSk9gTcr5XaFeAC9UjTq5NeClFEeaIlk-C78iAA7CH07bjKdoHNmXTn7WxI7eLol3kvYRYSTHuZUF33e" +
  "-1nhzdCX3BdRRg4QEjEXkQaVMF1PrNPM2V81hfRb-GvpW0tJknNXVSbFiyAW466IQ-JH1t6MQ7pOLzoZ4DyomqbzcprVQAy4kEno4QyTyczX" +
  "MgTW5jTmXp2MBcg8Gh4UwGHx93eI8lLdZ4I";

const NOW = new Date("2026-10-22T09:00:00Z");
const bundle = (patch: Record<string, unknown> = {}) => ({
  v: 1,
  challengeId: CHALLENGE_ID,
  kind: "CONNECT",
  isu: 100001,
  issuedAt: "2026-10-22T08:59:00Z",
  itmo: { sid: "sid-1", expiresAt: "2027-01-20T09:00:00Z", refreshToken: "test-refresh", refreshExpiresAt: "2026-11-21T09:00:00Z" },
  ...patch,
});

describe("pairing crypto", () => {
  it("matches the app's commitment and info vectors", async () => {
    const target = await PairingTarget.fromRaw(PRIVATE_KEY, PUBLIC_KEY, SECRET);

    expect(Buffer.from(target.keyCommitment(), "base64url").toString("hex")).toBe(
      "20758b0aa1a0d853c836e33b6295d0f4b96108abbeca9699419f52014a03f665",
    );
    expect(pairingInfo(CHALLENGE_ID, "AGENT" as never, SECRET).toString("hex")).toBe(INFO_HEX);
  });

  it("opens what CryptoKit sealed with the same suite", async () => {
    const key = await suite.kem.importKey("raw", new Uint8Array(PRIVATE_KEY).buffer, false);
    const raw = Buffer.from(SEALED_BY_CRYPTOKIT, "base64url");

    const plain = await suite.open(
      { recipientKey: key, enc: new Uint8Array(raw.subarray(0, 32)).buffer, info: new Uint8Array(Buffer.from(INFO_HEX, "hex")).buffer },
      new Uint8Array(raw.subarray(32)).buffer,
    );

    expect(JSON.parse(Buffer.from(plain).toString())).toMatchObject({ kind: "AGENT", isu: 100001, v: 1 });
  });

  it("builds the v1 link the app parses", async () => {
    const target = await PairingTarget.fromRaw(PRIVATE_KEY, PUBLIC_KEY, SECRET);

    expect(target.link("https://dev.widgets.alllexey.dev", "ABCD2345")).toBe(
      "https://dev.widgets.alllexey.dev/pair#v1.ABCD2345.QxDul9iMwfCIpVdsd6sM9cOseX89lROcbIS1QpxZZio.AAECAwQFBgcICQoLDA0ODw",
    );
  });

  it("opens a bundle sealed to its link and checks it", async () => {
    const target = await PairingTarget.create();
    const link = target.link("https://widgets.test", "ABCD2345");

    const opened = await target.open(await sealForLink(link, CHALLENGE_ID, "CONNECT", bundle()), CHALLENGE_ID, "CONNECT", NOW);

    expect(opened.itmo).toMatchObject({ sid: "sid-1", refreshToken: "test-refresh" });
    for (const [kind, patch] of [
      ["RENEW", {}],
      ["CONNECT", { challengeId: "0190f1a2-3b4c-7d5e-8f60-000000000000" }],
      ["CONNECT", { issuedAt: "2026-10-22T08:40:00Z" }],
      ["CONNECT", { itmo: { sid: "s" } }],
      ["CONNECT", { v: 2 }],
    ] as const) {
      const sealed = await sealForLink(link, CHALLENGE_ID, kind, bundle({ ...patch, kind }));
      await expect(target.open(sealed, CHALLENGE_ID, kind === "RENEW" ? "CONNECT" : kind, NOW)).rejects.toBeInstanceOf(BundleError);
    }
    await expect(target.open("AAAA", CHALLENGE_ID, "CONNECT", NOW)).rejects.toBeInstanceOf(BundleError);
  });

  describe("bundle v2", () => {
    const v2 = (patch: Record<string, unknown> = {}, itmo: Record<string, unknown> | null = {}) => ({
      v: 2,
      challengeId: CHALLENGE_ID,
      kind: "CONNECT",
      clientId: "itmo-mcp",
      isu: 100001,
      issuedAt: "2026-10-22T08:59:00Z",
      itmo:
        itmo === null
          ? undefined
          : {
              sid: "sid-2",
              expiresAt: "2027-01-20T09:00:00Z",
              items: [
                { grant: "itmo:refresh:student-personal-cabinet", value: "test-refresh", expiresAt: "2026-11-21T09:00:00Z" },
                { grant: "itmo:refresh:some-other-client", value: "other", expiresAt: "2026-11-21T09:00:00Z" },
                { grant: "itmo:sso", value: "test-cookie", expiresAt: "2027-01-20T09:00:00Z" },
              ],
              ...itmo,
            },
      ...patch,
    });

    async function openV2(bundle: unknown) {
      const target = await PairingTarget.create();
      const link = target.link("https://widgets.test", "ABCD2345");
      return target.open(await sealForLink(link, CHALLENGE_ID, "CONNECT", bundle), CHALLENGE_ID, "CONNECT", NOW);
    }

    it("reads the refresh token and the cookie and ignores grants it does not know", async () => {
      const opened = await openV2(v2());

      expect(opened).toEqual({
        v: 2,
        challengeId: CHALLENGE_ID,
        kind: "CONNECT",
        isu: 100001,
        issuedAt: "2026-10-22T08:59:00Z",
        itmo: {
          sid: "sid-2",
          expiresAt: "2027-01-20T09:00:00Z",
          grants: ["itmo:refresh:student-personal-cabinet", "itmo:sso"],
          refreshToken: "test-refresh",
          refreshExpiresAt: "2026-11-21T09:00:00Z",
          keycloakIdentity: "test-cookie",
          keycloakIdentityExpiresAt: "2027-01-20T09:00:00Z",
        },
      });
    });

    it("takes the cookie alone, and no ITMO session when no known grant came", async () => {
      const cookieOnly = await openV2(v2({}, { items: [{ grant: "itmo:sso", value: "c", expiresAt: "2027-01-20T09:00:00Z" }] }));
      const unknownOnly = await openV2(v2({}, { items: [{ grant: "itmo:identity", value: "x", expiresAt: "2027-01-20T09:00:00Z" }] }));
      const none = await openV2(v2({}, null));

      expect(cookieOnly.itmo).toMatchObject({ grants: ["itmo:sso"], keycloakIdentity: "c" });
      expect(cookieOnly.itmo?.refreshToken).toBeUndefined();
      expect(unknownOnly.itmo).toBeUndefined();
      expect(none).toMatchObject({ v: 2, isu: 100001 });
      expect(none.itmo).toBeUndefined();
    });

    it("refuses another client's bundle and malformed fields", async () => {
      const item = (patch: Record<string, unknown>) => ({
        items: [{ grant: "itmo:sso", value: "c", expiresAt: "2027-01-20T09:00:00Z", ...patch }],
      });
      for (const bundle of [
        v2({ clientId: "itmo-widgets-agent" }),
        v2({ clientId: undefined }),
        v2({ isu: "100001" }),
        v2({ issuedAt: undefined }),
        v2({ kind: "RENEW" }),
        v2({}, { sid: "" }),
        v2({}, { sid: undefined }),
        v2({}, { expiresAt: "soon" }),
        v2({}, { items: undefined }),
        v2({}, { items: [null] }),
        v2({}, item({ grant: undefined })),
        v2({}, item({ value: "" })),
        v2({}, item({ value: 5 })),
        v2({}, item({ expiresAt: undefined })),
        v2({}, { items: [...item({}).items, ...item({}).items] }),
        v2({ v: 3 }),
      ]) {
        await expect(openV2(bundle)).rejects.toBeInstanceOf(BundleError);
      }
    });
  });
});
