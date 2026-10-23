import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { createConnection } from "./app.js";
import type { Config } from "./config.js";
import type { FetchFn } from "./http.js";
import { WidgetsApiError } from "./widgets/client.js";
import { forgetConnection, pair, type PairingView, renew } from "./widgets/pairing.js";
import { terminalQr } from "./widgets/qr.js";

/** Terminal of a CLI command: output, yes/no questions and child processes. */
export interface Terminal {
  write(text: string): void;
  confirm(question: string): Promise<boolean>;
}

export interface CommandContext {
  config: Config;
  terminal: Terminal;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

const DAY_MS = 24 * 60 * 60_000;

function view(terminal: Terminal): PairingView {
  return {
    link(link) {
      terminal.write(
        "Откройте ITMO.Widgets на телефоне -> Профиль -> Устройства -> «Подключить устройство» и отсканируйте QR:\n\n" +
          terminalQr(link) +
          `\nИли вставьте ссылку в приложении:\n${link}\n\nСсылка действует 2 минуты, не пересылайте её.\n`,
      );
    },
    opened(code) {
      terminal.write(`\nКод проверки: ${code}. Сверьте его с экраном телефона и подтвердите там.\n`);
    },
  };
}

function pairingDeps(context: CommandContext) {
  const connection = createConnection(context.config, context.fetchFn);
  return {
    ...connection,
    pairing: {
      widgets: connection.widgets,
      idClient: connection.idClient,
      store: connection.store,
      origin: context.config.widgetsUrl,
      view: view(context.terminal),
      sleep: context.sleep,
    },
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}

/** A pairing name for the phone: the host name without its domain, 1-60 characters. */
export function defaultName(): string {
  const name = hostname().split(".")[0]!.replace(/\p{Cc}/gu, "").trim().slice(0, 60);
  return name || "itmo-mcp";
}

export async function pairCommand(context: CommandContext, options: { name?: string; scopes?: string[] } = {}) {
  const { pairing } = pairingDeps(context);
  const connection = await pair(pairing, { name: options.name ?? defaultName(), scopes: options.scopes });
  context.terminal.write(
    `\nПодключено: «${connection.name}», ISU ${connection.isu}. Вход в ИТМО до ${formatDate(connection.itmo.expiresAt)}.\n` +
      "Перезапустите MCP-клиент, если itmo-mcp в нём уже запущен.\n",
  );
}

export async function renewCommand(context: CommandContext) {
  const { pairing } = pairingDeps(context);
  const connection = await renew(pairing);
  context.terminal.write(`\nВход в ИТМО обновлён: до ${formatDate(connection.itmo.expiresAt)}.\n`);
}

export async function statusCommand(context: CommandContext, now = new Date()) {
  const { store, widgets } = pairingDeps(context);
  const { connection } = await store.read();
  const write = (text: string) => context.terminal.write(text);
  if (!connection) {
    write("ITMO.Widgets: не подключено. Подключить: itmo-mcp pair\n");
    return;
  }
  const days = Math.floor((Date.parse(connection.itmo.expiresAt) - now.getTime()) / DAY_MS);
  const health =
    connection.itmo.status === "closed"
      ? "закрыт, выполните itmo-mcp renew"
      : `работает до ${formatDate(connection.itmo.expiresAt)}${days < 7 ? ` (осталось ${Math.max(days, 0)} дн., выполните itmo-mcp renew)` : ""}`;
  write(`ITMO.Widgets: MCP «${connection.name}», ISU ${connection.isu}\nВход в ИТМО: ${health}\n`);
  try {
    const me = await widgets.me();
    const granted = me.connection.scopes.filter((grant) => grant.granted).map((grant) => grant.scope.title);
    write(`Доступы: ${granted.join(", ") || "нет"}\nСервер ITMO.Widgets: доступен\n`);
  } catch (error) {
    if (error instanceof WidgetsApiError && error.status === 401) {
      write("Подключение отозвано в приложении: вход в ИТМО завершён, данные подключения удалены.\n");
      return;
    }
    write(`Сервер ITMO.Widgets: недоступен (${error instanceof Error ? error.message : String(error)})\n`);
  }
}

export async function unpairCommand(context: CommandContext) {
  const { store, idClient, widgets } = pairingDeps(context);
  if (!(await store.read()).connection) {
    context.terminal.write("ITMO.Widgets: не подключено.\n");
    return;
  }
  let serverError: unknown;
  try {
    await widgets.revokeSelf();
  } catch (error) {
    if (!(error instanceof WidgetsApiError && error.status === 401)) serverError = error;
  }
  await forgetConnection(store, idClient);
  context.terminal.write(
    serverError
      ? "Вход в ИТМО завершён, данные удалены, но сервер ITMO.Widgets не ответил: отключите устройство в приложении.\n"
      : "Отключено: вход в ИТМО завершён, данные удалены.\n",
  );
}

/** Env of this run worth copying into MCP client configs; secrets are never copied. */
function passthroughEnv(): [string, string][] {
  return ["ITMO_MCP_STATE_DIR", "ITMO_WIDGETS_URL", "ITMO_MCP_ENABLE_WRITES", "ITMO_BROWSER_UA"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]!] as [string, string]] : [],
  );
}

const SERVER_COMMAND = ["npx", "-y", "itmo-mcp"];

function hasCommand(command: string): boolean {
  return !spawnSync(command, ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).error;
}

/** Adds the `itmo` server to Cursor's user `mcp.json`, keeping every other entry. */
export async function addToCursor(file: string, env: [string, string][]): Promise<void> {
  let config: { mcpServers?: Record<string, unknown> } = {};
  try {
    config = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`${file} is not valid JSON; edit it by hand`);
  }
  const [command, ...args] = SERVER_COMMAND;
  config.mcpServers = { ...config.mcpServers, itmo: { command, args, ...(env.length ? { env: Object.fromEntries(env) } : {}) } };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
}

/** `setup`: `pair` unless already paired, then adds itmo-mcp to Claude Code, Codex and Cursor, asking for each. */
export async function setupCommand(context: CommandContext, options: { name?: string; scopes?: string[] } = {}) {
  const { store } = pairingDeps(context);
  if ((await store.read()).connection) context.terminal.write("ITMO.Widgets уже подключено.\n");
  else await pairCommand(context, options);

  const env = passthroughEnv();
  const clients: { name: string; available: () => boolean; add: () => Promise<void> | void }[] = [
    {
      name: "Claude Code",
      available: () => hasCommand("claude"),
      add: () => run("claude", ["mcp", "add", "--scope", "user", "itmo", ...env.flatMap(([k, v]) => ["-e", `${k}=${v}`]), "--", ...SERVER_COMMAND]),
    },
    {
      name: "Codex",
      available: () => hasCommand("codex"),
      add: () => run("codex", ["mcp", "add", "itmo", ...env.flatMap(([k, v]) => ["--env", `${k}=${v}`]), "--", ...SERVER_COMMAND]),
    },
    {
      name: "Cursor",
      available: () => existsSync(join(homedir(), ".cursor")),
      add: () => addToCursor(join(homedir(), ".cursor", "mcp.json"), env),
    },
  ];
  for (const client of clients) {
    if (!client.available()) continue;
    if (!(await context.terminal.confirm(`Добавить itmo-mcp в ${client.name}?`))) continue;
    await client.add();
    context.terminal.write(`${client.name}: добавлено.\n`);
  }
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed`);
}
