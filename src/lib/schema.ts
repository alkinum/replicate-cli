export interface SimplifiedSchemaField {
  name: string;
  type?: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  description?: string;
  title?: string;
  order?: number;
  format?: string;
  file?: boolean;
}

export interface SchemaValidationIssue {
  field: string;
  code: string;
  message: string;
}

export function simplifyOpenApiSchema(schema: unknown): SimplifiedSchemaField[] {
  const inputSchema = locateInputSchema(schema);
  const required = new Set<string>(
    Array.isArray(inputSchema?.required) ? (inputSchema.required as string[]) : []
  );
  const properties = inputSchema?.properties;
  if (!properties || typeof properties !== "object") return [];

  return Object.entries(properties as Record<string, Record<string, unknown>>)
    .map(([name, property]) => simplifyField(name, property, required.has(name)))
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name));
}

export function validateInputAgainstOpenApiSchema(
  schema: unknown,
  input: Record<string, unknown>
): SchemaValidationIssue[] {
  const fields = simplifyOpenApiSchema(schema);
  const issues: SchemaValidationIssue[] = [];
  for (const field of fields) {
    const value = input[field.name];
    if (field.required && value === undefined) {
      issues.push({
        field: field.name,
        code: "required",
        message: `${field.name} is required.`
      });
      continue;
    }
    if (value === undefined || value === null) continue;
    if (field.enum && !field.enum.includes(value)) {
      issues.push({
        field: field.name,
        code: "enum",
        message: `${field.name} must be one of: ${field.enum.map(String).join(", ")}.`
      });
    }
    if (!matchesFieldType(value, field)) {
      issues.push({
        field: field.name,
        code: "type",
        message: `${field.name} must be ${field.type}.`
      });
    }
    if (typeof value === "number" && field.minimum !== undefined && value < field.minimum) {
      issues.push({
        field: field.name,
        code: "minimum",
        message: `${field.name} must be greater than or equal to ${field.minimum}.`
      });
    }
    if (typeof value === "number" && field.maximum !== undefined && value > field.maximum) {
      issues.push({
        field: field.name,
        code: "maximum",
        message: `${field.name} must be less than or equal to ${field.maximum}.`
      });
    }
  }
  return issues;
}

function locateInputSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const root = schema as Record<string, unknown>;
  const components = root.components as Record<string, unknown> | undefined;
  const schemas = components?.schemas as Record<string, unknown> | undefined;
  const directInput = schemas?.Input as Record<string, unknown> | undefined;
  if (directInput) return directInput;

  const paths = root.paths as Record<string, unknown> | undefined;
  for (const path of Object.values(paths ?? {})) {
    const methods = path as Record<string, unknown>;
    for (const operation of Object.values(methods)) {
      const op = operation as Record<string, unknown>;
      const schemaObject = (((op.requestBody as Record<string, unknown> | undefined)?.content as Record<string, unknown> | undefined)?.[
        "application/json"
      ] as Record<string, unknown> | undefined)?.schema as Record<string, unknown> | undefined;
      const input = (schemaObject?.properties as Record<string, unknown> | undefined)?.input;
      if (input && typeof input === "object") return input as Record<string, unknown>;
    }
  }

  if ("properties" in root) return root;
  return undefined;
}

function simplifyField(
  name: string,
  property: Record<string, unknown>,
  required: boolean
): SimplifiedSchemaField {
  const merged = mergeComposed(property);
  const type = typeFor(merged);
  return {
    name,
    type,
    required,
    default: merged.default,
    enum: Array.isArray(merged.enum) ? merged.enum : undefined,
    minimum: typeof merged.minimum === "number" ? merged.minimum : undefined,
    maximum: typeof merged.maximum === "number" ? merged.maximum : undefined,
    description: typeof merged.description === "string" ? merged.description : undefined,
    title: typeof merged.title === "string" ? merged.title : undefined,
    order: typeof merged["x-order"] === "number" ? merged["x-order"] : undefined,
    format: typeof merged.format === "string" ? merged.format : undefined,
    file:
      merged.format === "uri" ||
      type === "file" ||
      /file|image|audio|video/i.test(`${name} ${String(merged.description ?? "")}`)
  };
}

function mergeComposed(property: Record<string, unknown>): Record<string, unknown> {
  const allOf = property.allOf;
  if (!Array.isArray(allOf)) return property;
  return Object.assign({}, ...allOf.filter((item) => item && typeof item === "object"), property);
}

function typeFor(property: Record<string, unknown>): string | undefined {
  if (typeof property.type === "string") return property.type;
  if (property.format === "binary") return "file";
  if (Array.isArray(property.enum)) return "string";
  if (Array.isArray(property.oneOf)) return "union";
  if (Array.isArray(property.anyOf)) return "union";
  if (Array.isArray(property.allOf)) return "object";
  return undefined;
}

function matchesFieldType(value: unknown, field: SimplifiedSchemaField): boolean {
  if (field.file && isDryRunFilePreview(value)) return true;
  return matchesType(value, field.type);
}

function isDryRunFilePreview(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.file === "string" && typeof record.mode === "string";
}

function matchesType(value: unknown, type: string | undefined): boolean {
  if (!type || type === "union" || type === "file") return true;
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number";
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  return true;
}
