import { readFileSync } from "node:fs";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

interface OperationRef {
  path: string;
  method: HttpMethod;
}

export interface SpecValidator {
  operationIds(): string[];
  validateResponse(operationId: string, body: unknown, status?: string): ErrorObject[];
}

const escapePointer = (segment: string) => segment.replaceAll("~", "~0").replaceAll("/", "~1");

export function loadSpecValidator(specPath: string): SpecValidator {
  const spec = parse(readFileSync(specPath, "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats.default(ajv);
  ajv.addFormat("int32", true);
  ajv.addFormat("int64", true);
  ajv.addSchema({ ...spec, $id: "spec" });

  const operations = new Map<string, OperationRef>();
  for (const [path, item] of Object.entries<Record<string, { operationId?: string }>>(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (op?.operationId) operations.set(op.operationId, { path, method: method as HttpMethod });
    }
  }

  const compiled = new Map<string, ValidateFunction>();
  const validatorFor = (operationId: string, status: string) => {
    const key = `${operationId}:${status}`;
    let validate = compiled.get(key);
    if (!validate) {
      const op = operations.get(operationId);
      if (!op) throw new Error(`Unknown operationId ${operationId} in ${specPath}`);
      const pointer = ["paths", op.path, op.method, "responses", status, "content", "application/json", "schema"]
        .map(escapePointer)
        .join("/");
      validate = ajv.compile({ $ref: `spec#/${pointer}` });
      compiled.set(key, validate);
    }
    return validate;
  };

  return {
    operationIds: () => [...operations.keys()],
    validateResponse(operationId, body, status = "200") {
      const validate = validatorFor(operationId, status);
      return validate(body) ? [] : (validate.errors ?? []);
    },
  };
}

export function formatErrors(errors: ErrorObject[]): string {
  return errors.map((e) => `${e.instancePath || "/"} ${e.keyword} ${e.message ?? ""}`).join("\n");
}
