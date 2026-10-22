import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Long-lived credentials rotated by ITMO.ID; persisted so restarts do not need a new login. */
export interface AuthState {
  /** my.itmo.ru refresh token: of the paired session when `connection` is set, else of the env credentials. */
  refreshToken?: string;
  keycloakIdentity?: string;
  connection?: Connection;
}

/** The pairing with ITMO.Widgets (`itmo-mcp pair`): its connection token and the ITMO.ID session the phone signed in. */
export interface Connection {
  /** `iwc_` bearer for the ITMO.Widgets API. */
  token: string;
  id: string;
  name: string;
  isu: number;
  itmo: {
    sid: string;
    expiresAt: string;
    refreshExpiresAt?: string;
    /** `closed` once ITMO.ID refused the session's refresh token; `itmo-mcp renew` brings a new session. */
    status: "ok" | "closed";
  };
}

export class StateStore {
  private readonly file: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.file = join(dir, "state.json");
  }

  async read(): Promise<AuthState> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as AuthState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  /** Merges the patch into the stored state; writes are serialized, atomic and owner-only (0600). */
  update(patch: AuthState): Promise<void> {
    const write = this.queue.then(async () => {
      const next = { ...(await this.read()), ...patch };
      const dir = join(this.file, "..");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, this.file);
    });
    this.queue = write.catch(() => undefined);
    return write;
  }
}
