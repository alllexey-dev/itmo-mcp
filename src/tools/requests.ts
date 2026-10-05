import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { result } from "../clients/my-itmo.js";
import { ItmoApiError } from "../clients/errors.js";
import type { components } from "../generated/my-itmo.js";
import type { PendingActions } from "./actions.js";
import type { ToolDeps } from "./deps.js";
import { PREVIEW, READ_ONLY, run, ToolRefusal } from "./format.js";

type Template = components["schemas"]["RequestTemplate"];
type Field = components["schemas"]["RequestField"];
type Option = components["schemas"]["RequestOption"];

/** Requests an agent must never file: they change the student's status at the university. */
const BLOCKED = /отчисл|академическ\w* отпуск|перевод|восстановл|expuls|academic leave/i;
const SUPPORTED_TYPES = new Set(["text", "number", "date", "date_time", "dictionary"]);
const MAX_OPTIONS = 40;

export function stripHtml(html: string | null | undefined, limit = 1500): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export function registerRequestTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "itmo_requests_catalog",
    {
      title: "Request and certificate types",
      description:
        "Types of requests and certificates (справки, заявления) that can be filed on my.itmo.ru, grouped by category. " +
        "Use template_id with itmo_request_form.",
      inputSchema: { query: z.string().optional().describe("Case-insensitive part of a category or request name") },
      annotations: { title: "Request and certificate types", ...READ_ONLY },
    },
    ({ query }) =>
      run(async () => {
        const catalog = (await result("getRequestCatalog", deps.my.GET("/api/requests/all"))) ?? [];
        const needle = query?.toLocaleLowerCase();
        return catalog
          .map((category) => ({
            category: category.name,
            templates: category.requests
              .filter((r) => !needle || category.name.toLocaleLowerCase().includes(needle) || r.name.toLocaleLowerCase().includes(needle))
              .map((r) => ({ template_id: r.id, name: r.name })),
          }))
          .filter((c) => c.templates.length > 0);
      }),
  );

  server.registerTool(
    "itmo_request_form",
    {
      title: "Request form",
      description:
        "Fields of a request template: names, types, required flags, defaults and options of choice fields, " +
        "plus whether the student can file it now. Field values go to itmo_request_submit_preview.",
      inputSchema: { template_id: z.number().int() },
      annotations: { title: "Request form", ...READ_ONLY },
    },
    ({ template_id }) =>
      run(async () => {
        const template = await loadTemplate(deps, template_id);
        const values = defaults(template);
        const fields = await Promise.all(
          template.fields_data.map(async (f) => {
            const options = f.field_type === "dictionary" ? await dictionary(deps, f, values) : undefined;
            return {
              field_id: f.field_id,
              name: f.field_name,
              type: f.field_type,
              required: f.required_field_flag || undefined,
              shown_initially: f.show_condition_flag !== false,
              read_only: f.disabled_field_flag || undefined,
              default: f.init_dictionary?.text ?? (typeof f.default_value === "string" ? f.default_value : undefined),
              options: options?.slice(0, MAX_OPTIONS).map((o) => o.text),
              more_options: options && options.length > MAX_OPTIONS ? options.length - MAX_OPTIONS : undefined,
              note: f.field_note,
              supported: SUPPORTED_TYPES.has(f.field_type) || undefined,
            };
          }),
        );
        return {
          template: template.template_name,
          can_file_now: template.user_can_apply_now,
          why_not: template.user_cannot_apply_now_reason,
          handled_by: template.responsible_units?.map((u) => u.dep_name),
          description: stripHtml(template.template_description),
          fields,
        };
      }),
  );

  server.registerTool(
    "itmo_get_request_details",
    {
      title: "Request details",
      description: "Status, entered fields and office notes of one of the student's submitted requests.",
      inputSchema: { request_id: z.number().int().describe("Request id from itmo_get_requests") },
      annotations: { title: "Request details", ...READ_ONLY },
    },
    ({ request_id }) =>
      run(async () => {
        const request = await result(
          "getMyRequest",
          deps.my.GET("/api/requests/my/{requestId}", { params: { path: { requestId: request_id } } }),
        );
        return (
          request && {
            request_id: request.request_id,
            name: request.request_name,
            status: request.request_status,
            state: request.request_state,
            created: request.request_create_date,
            fields: request.entered_fields?.map((f) => ({ name: f.name, value: f.data })),
          }
        );
      }),
  );
}

export function registerRequestActionTools(server: McpServer, deps: ToolDeps, actions: PendingActions): void {
  server.registerTool(
    "itmo_request_submit_preview",
    {
      title: "Preview: file a request",
      description:
        "Fills a request form (e.g. a certificate of study) with defaults plus the given values, checks required " +
        "fields and prepares the submission. Values are keyed by field name or field_id; choice fields accept the " +
        "option text. Requests that change enrollment status are refused. Nothing changes until itmo_confirm_action.",
      inputSchema: {
        template_id: z.number().int(),
        values: z.record(z.string(), z.string()).default({}).describe('e.g. {"Количество": "2", "Язык печати справки": "Английский"}'),
      },
      annotations: { title: "Preview: file a request", ...PREVIEW },
    },
    ({ template_id, values }) =>
      run(async () => {
        const [template, catalog] = await Promise.all([
          loadTemplate(deps, template_id),
          result("getRequestCatalog", deps.my.GET("/api/requests/all")),
        ]);
        const category = catalog?.find((c) => c.requests.some((r) => r.id === template_id))?.name ?? "";
        if (BLOCKED.test(template.template_name) || BLOCKED.test(category)) {
          throw new ToolRefusal("This request changes the student's status at the university: file it on my.itmo.ru yourself");
        }
        if (template.user_can_apply_now === false) {
          throw new ToolRefusal(`The request cannot be filed now${template.user_cannot_apply_now_reason ? `: ${template.user_cannot_apply_now_reason}` : ""}`);
        }

        const state = defaults(template);
        const labels = new Map<number, string>();
        for (const f of template.fields_data) if (f.init_dictionary) labels.set(f.field_id, f.init_dictionary.text);
        const visible = new Set(template.fields_data.filter((f) => f.show_condition_flag !== false).map((f) => f.field_id));

        for (const [key, raw] of Object.entries(values)) {
          const field = findField(template, key);
          if (!SUPPORTED_TYPES.has(field.field_type)) {
            throw new ToolRefusal(`Field "${field.field_name}" (${field.field_type}) cannot be filled by the agent`);
          }
          if (field.disabled_field_flag) throw new ToolRefusal(`Field "${field.field_name}" is read-only`);
          const encoded = await encode(deps, field, raw, state);
          state.set(field.field_id, encoded.value);
          labels.set(field.field_id, encoded.label);
          const changes = await result(
            "updateRequestForm",
            deps.my.POST("/api/requests/form_update", {
              body: {
                changed_field: field.field_id,
                current_values: currentValues(template, state),
              },
            }),
          );
          for (const id of changes?.show ?? []) visible.add(Number(id));
          for (const id of changes?.hide ?? []) visible.delete(Number(id));
        }

        const warnings = ["The request goes to a university office and cannot be undone after it is processed."];
        for (const key of Object.keys(values)) {
          const field = findField(template, key);
          if (!visible.has(field.field_id)) {
            state.delete(field.field_id);
            warnings.push(`"${field.field_name}" is hidden for the chosen options and was not filled.`);
          }
        }
        const shown = template.fields_data.filter((f) => visible.has(f.field_id));
        for (const f of shown) {
          if (f.field_type !== "dictionary" || !f.required_field_flag || state.get(f.field_id)) continue;
          const options = await dictionary(deps, f, state);
          if (options.length === 1) {
            state.set(f.field_id, String(options[0]!.id));
            labels.set(f.field_id, options[0]!.text);
          }
        }
        const missing = shown.filter((f) => f.required_field_flag && !state.get(f.field_id));
        if (missing.length) {
          throw new ToolRefusal(`Fill the required fields: ${missing.map((f) => `${f.field_name} (${f.field_id})`).join(", ")}`);
        }
        const unsupported = shown.filter((f) => f.required_field_flag && !SUPPORTED_TYPES.has(f.field_type));
        if (unsupported.length) {
          throw new ToolRefusal(`Required fields of unsupported types: ${unsupported.map((f) => f.field_name).join(", ")}; file it on my.itmo.ru`);
        }

        const body = {
          request_id: template_id,
          values: template.fields_data
            .filter((f) => state.get(f.field_id))
            .map((f) => ({ field_id: String(f.field_id), field_type: f.field_type, value: state.get(f.field_id)! })),
        };
        return actions.propose(
          {
            action: `File the request "${template.template_name}"`,
            details: {
              handled_by: template.responsible_units?.map((u) => u.dep_name),
              fields: Object.fromEntries(
                shown.filter((f) => state.get(f.field_id)).map((f) => [f.field_name, labels.get(f.field_id) ?? state.get(f.field_id)]),
              ),
            },
            warnings,
          },
          async () => {
            const { data, error, response } = await deps.my.POST("/api/requests/send", { body });
            const envelope = (data ?? error) as { error_code?: number | null; error_message?: string | null; result?: { reqId?: unknown; error_list?: { field_id: unknown; error_text: string }[] } } | undefined;
            const errors = envelope?.result?.error_list;
            if (errors?.length) {
              const name = (id: unknown) => template.fields_data.find((f) => String(f.field_id) === String(id))?.field_name ?? String(id);
              throw new ToolRefusal(`The office form rejected the values: ${errors.map((e) => `${name(e.field_id)}: ${e.error_text}`).join("; ")}`);
            }
            if (!response.ok || envelope?.error_code) {
              throw new ItmoApiError("my.itmo.ru", "sendRequest", response.status, envelope?.error_code ?? undefined, envelope?.error_message ?? undefined);
            }
            return { request_id: envelope?.result?.reqId };
          },
        );
      }),
  );

  server.registerTool(
    "itmo_request_cancel_preview",
    {
      title: "Preview: cancel a request",
      description: "Prepares cancellation of a submitted request that is not processed or rejected yet. Irreversible. Nothing changes until itmo_confirm_action.",
      inputSchema: { request_id: z.number().int() },
      annotations: { title: "Preview: cancel a request", ...PREVIEW },
    },
    ({ request_id }) =>
      run(async () => {
        const request = await result(
          "getMyRequest",
          deps.my.GET("/api/requests/my/{requestId}", { params: { path: { requestId: request_id } } }),
        );
        if (!request) throw new ToolRefusal(`Request ${request_id} was not found`);
        if (request.request_status_tag === "processed" || request.request_status_tag === "rejected") {
          throw new ToolRefusal(`The request is already ${request.request_status_tag} and cannot be cancelled`);
        }
        return actions.propose(
          {
            action: `Cancel the request "${request.request_name}"`,
            details: { request_id, status: request.request_status, created: request.request_create_date },
            warnings: ["Cancellation is irreversible: a new request would have to be filed."],
          },
          async () => {
            await result(
              "cancelMyRequest",
              deps.my.DELETE("/api/requests/my/{requestId}", { params: { path: { requestId: request_id } } }),
            );
            return { cancelled_request_id: request_id };
          },
        );
      }),
  );
}

async function loadTemplate(deps: ToolDeps, templateId: number): Promise<Template> {
  const template = await result(
    "getRequestTemplate",
    deps.my.GET("/api/requests/{templateId}", { params: { path: { templateId } } }),
  );
  if (!template) throw new ToolRefusal(`Request template ${templateId} was not found`);
  return template;
}

/** Initial form state as the portal builds it: dictionary defaults by id, other defaults as strings. */
function defaults(template: Template): Map<number, string> {
  const state = new Map<number, string>();
  for (const f of template.fields_data) {
    const value = f.init_dictionary?.id ?? (typeof f.default_value === "string" || typeof f.default_value === "number" ? f.default_value : undefined);
    if (value !== undefined && value !== "") state.set(f.field_id, String(value));
  }
  return state;
}

function findField(template: Template, key: string): Field {
  const lower = key.trim().toLocaleLowerCase();
  const field =
    template.fields_data.find((f) => String(f.field_id) === key.trim()) ??
    template.fields_data.find((f) => f.field_name.toLocaleLowerCase() === lower) ??
    unique(template.fields_data.filter((f) => f.field_name.toLocaleLowerCase().includes(lower)));
  if (!field) {
    throw new ToolRefusal(`Unknown field "${key}"; fields: ${template.fields_data.map((f) => `${f.field_name} (${f.field_id})`).join(", ")}`);
  }
  return field;
}

async function dictionary(deps: ToolDeps, field: Field, state: Map<number, string>, q?: string): Promise<Option[]> {
  if (!field.dictionary_id) return [];
  const dep = field.dependent_field_id ? state.get(field.dependent_field_id) : undefined;
  return (
    (await result(
      "getRequestDictionary",
      deps.my.GET("/api/requests/dict/{dictionaryId}", {
        params: { path: { dictionaryId: field.dictionary_id }, query: { field: field.field_id, q, dep } },
      }),
    )) ?? []
  );
}

async function encode(deps: ToolDeps, field: Field, raw: string, state: Map<number, string>): Promise<{ value: string; label: string }> {
  const text = raw.trim();
  switch (field.field_type) {
    case "dictionary": {
      const parts = field.multiple_choice ? text.split(/\s*[,;]\s*/) : [text];
      const chosen = await Promise.all(parts.map((part) => resolveOption(deps, field, part, state)));
      return { value: chosen.map((o) => String(o.id)).join(","), label: chosen.map((o) => o.text).join(", ") };
    }
    case "date": {
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      const value = iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : text;
      if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) throw new ToolRefusal(`"${field.field_name}" needs a date, YYYY-MM-DD`);
      return { value, label: value };
    }
    case "date_time": {
      const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})$/.exec(text);
      const value = iso ? `${iso[3]}.${iso[2]}.${iso[1]} ${iso[4]}` : text;
      if (!/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(value)) throw new ToolRefusal(`"${field.field_name}" needs YYYY-MM-DD HH:mm`);
      return { value, label: value };
    }
    case "number":
      if (!/^-?\d+([.,]\d+)?$/.test(text)) throw new ToolRefusal(`"${field.field_name}" needs a number`);
      return { value: text.replace(",", "."), label: text };
    default:
      return { value: text, label: text };
  }
}

async function resolveOption(deps: ToolDeps, field: Field, wanted: string, state: Map<number, string>): Promise<Option> {
  const lower = wanted.toLocaleLowerCase();
  const pick = (options: Option[]) =>
    options.find((o) => String(o.id) === wanted) ??
    options.find((o) => o.text.toLocaleLowerCase() === lower) ??
    unique(options.filter((o) => o.text.toLocaleLowerCase().includes(lower)));
  const all = await dictionary(deps, field, state);
  const found = pick(all) ?? pick(await dictionary(deps, field, state, wanted));
  if (!found) {
    const shown = all.slice(0, 20).map((o) => o.text).join("; ");
    throw new ToolRefusal(`"${wanted}" is not an option of "${field.field_name}"${shown ? `; options: ${shown}` : ""}`);
  }
  return found;
}

/** Form state exactly as the portal sends it: every field, string ids, field_type only for non-choice fields. */
function currentValues(template: Template, state: Map<number, string>) {
  return template.fields_data.map((f) =>
    f.field_type === "dictionary"
      ? { field_id: String(f.field_id), value: state.get(f.field_id) ?? "" }
      : { field_id: String(f.field_id), field_type: f.field_type, value: state.get(f.field_id) ?? "" },
  );
}

function unique<T>(items: T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}
