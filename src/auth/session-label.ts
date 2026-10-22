/**
 * User-Agents for an ITMO.ID sign-in, ported from MyItmoApi `ItmoSessionLabel`. The UA of a sign-in fixes the
 * session's row on id.itmo.ru `/activity` ("<os>, Browser: <browser>") for its whole life; refreshes and silent
 * sign-ins with another UA do not change it. Platforms are `linux`, `macos` and `windows`; anything else is none.
 */

/** Latest stable Chrome major version; bumped with releases, since an old version is a tell of its own. */
export const CHROME_MAJOR_VERSION = 155;

const LINUX = "X11; Linux x86_64";
const MAX_NAME = 50;

function os(platform: string | undefined): string | undefined {
  switch (platform?.toLowerCase()) {
    case "linux":
      return LINUX;
    case "macos":
      return "Macintosh; Intel Mac OS X 10_15_7";
    case "windows":
      return "Windows NT 10.0; Win64; x64";
    default:
      return undefined;
  }
}

/** An ordinary desktop Chrome UA for the platform (none: Linux), so the row reads "Linux, Browser: Chrome 155". */
export function browserUserAgent(platform?: string): string {
  return `Mozilla/5.0 (${os(platform) ?? LINUX}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR_VERSION}.0.0.0 Safari/537.36`;
}

/**
 * The honest label `ITMO Widgets <client> <name> bot/<version> (<os>)`, which ITMO.ID shows as is. Client and name
 * keep only `[A-Za-z0-9 _!:[]-]` with spaces collapsed, the part before `/` stays within 50 characters, a version
 * outside `\d+(\.\d+){0,2}` becomes `1`, and no platform means no parentheses.
 */
export function botUserAgent(client: string, name?: string, version?: string, platform?: string): string {
  const words = [client, name ?? ""].map(clean).filter(Boolean);
  const head = ["ITMO Widgets", ...words].join(" ").slice(0, MAX_NAME - " bot".length).trimEnd();
  const trimmed = version?.trim() ?? "";
  const number = /^\d+(\.\d+){0,2}$/.test(trimmed) ? trimmed : "1";
  const system = os(platform);
  return `${head} bot/${number}${system ? ` (${system})` : ""}`;
}

function clean(value: string): string {
  return value.replace(/[^A-Za-z0-9 _!:[\]-]/g, "").split(" ").filter(Boolean).join(" ");
}

/** This machine as a pairing platform: `linux`, `macos`, `windows` or undefined. */
export function currentPlatform(): string | undefined {
  return { linux: "linux", darwin: "macos", win32: "windows" }[process.platform as string];
}
