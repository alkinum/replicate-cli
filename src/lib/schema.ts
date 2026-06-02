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
  nullable?: boolean;
}

export interface SchemaValidationIssue {
  field: string;
  code: string;
  message: string;
}

export function simplifyOpenApiSchema(schema: unknown): SimplifiedSchemaField[] {
  const root = asRecord(schema);
  const inputSchema = locateInputSchema(schema);
  const required = new Set<string>(
    Array.isArray(inputSchema?.required) ? (inputSchema.required as string[]) : []
  );
  const properties = inputSchema?.properties;
  if (!properties || typeof properties !== "object") return [];

  return Object.entries(properties as Record<string, Record<string, unknown>>)
    .map(([name, property]) => simplifyField(root, name, property, required.has(name)))
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
  root: Record<string, unknown> | undefined,
  name: string,
  property: Record<string, unknown>,
  required: boolean
): SimplifiedSchemaField {
  const merged = normalizeSchema(root, property);
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
    file: isFileField(root, name, merged),
    nullable: isNullable(merged) ? true : undefined
  };
}

function normalizeSchema(
  root: Record<string, unknown> | undefined,
  schema: unknown,
  seen = new Set<string>()
): Record<string, unknown> {
  const record = asRecord(schema);
  if (!record) return {};

  let merged: Record<string, unknown> = {};
  if (typeof record.$ref === "string") {
    merged = mergeDefined(merged, resolveRef(root, record.$ref, seen));
  }

  merged = mergeDefined(merged, omit(record, "$ref"));

  const allOf = merged.allOf;
  if (Array.isArray(allOf)) {
    merged = mergeDefined(
      ...allOf.map((item) => normalizeSchema(root, item, seen)),
      omit(merged, "allOf")
    );
  }

  for (const key of ["oneOf", "anyOf"]) {
    const variants = merged[key];
    if (Array.isArray(variants)) {
      merged[key] = variants.map((item) => normalizeSchema(root, item, seen));
    }
  }

  const items = merged.items;
  if (items && typeof items === "object") {
    merged.items = normalizeSchema(root, items, seen);
  }

  return merged;
}

function resolveRef(
  root: Record<string, unknown> | undefined,
  ref: string,
  seen: Set<string>
): Record<string, unknown> {
  if (!root || !ref.startsWith("#/") || seen.has(ref)) return {};
  seen.add(ref);
  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cursor: unknown = root;
  for (const part of parts) {
    cursor = asRecord(cursor)?.[part];
  }
  return normalizeSchema(root, cursor, seen);
}

function mergeDefined(...records: Record<string, unknown>[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (value !== undefined) output[key] = value;
    }
  }
  return output;
}

function omit(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !blocked.has(key)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function typeFor(property: Record<string, unknown>): string | undefined {
  const types = schemaTypes(property).filter((type) => type !== "null");
  if (types.length === 1) return types[0];
  if (types.length > 1) return "union";
  if (property.format === "binary") return "file";
  if (Array.isArray(property.enum)) return enumType(property.enum);
  return undefined;
}

function schemaTypes(property: Record<string, unknown>): string[] {
  const direct = property.type;
  if (typeof direct === "string") return [direct];
  if (Array.isArray(direct)) return uniqueStrings(direct);
  if (property.format === "binary") return ["file"];
  if (Array.isArray(property.enum)) return [enumType(property.enum)];

  const variants = variantSchemas(property);
  if (variants.length > 0) {
    return uniqueStrings(variants.flatMap((variant) => schemaTypes(variant)));
  }

  return [];
}

function enumType(values: unknown[]): string {
  const nonNull = values.filter((value) => value !== null);
  if (nonNull.every((value) => typeof value === "string")) return "string";
  if (nonNull.every((value) => Number.isInteger(value))) return "integer";
  if (nonNull.every((value) => typeof value === "number")) return "number";
  if (nonNull.every((value) => typeof value === "boolean")) return "boolean";
  return "union";
}

function variantSchemas(property: Record<string, unknown>): Record<string, unknown>[] {
  return [...variantsFor(property.oneOf), ...variantsFor(property.anyOf)];
}

function variantsFor(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string")));
}

function isNullable(property: Record<string, unknown>): boolean {
  const type = property.type;
  return (
    property.nullable === true ||
    (Array.isArray(type) && type.includes("null")) ||
    variantSchemas(property).some((variant) => schemaTypes(variant).includes("null"))
  );
}

function isFileField(
  root: Record<string, unknown> | undefined,
  name: string,
  property: Record<string, unknown>
): boolean {
  const type = typeFor(property);
  if (property.format === "uri" || property.format === "binary" || type === "file") return true;
  if (type === "array") {
    return isFileField(root, name, normalizeSchema(root, property.items));
  }
  return type === "string" && /(^|_)(file|image|images|audio|video|mask|document)(_|$)/i.test(name);
}

function matchesFieldType(value: unknown, field: SimplifiedSchemaField): boolean {
  if (field.file && field.type !== "array" && isDryRunFilePreview(value)) return true;
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
