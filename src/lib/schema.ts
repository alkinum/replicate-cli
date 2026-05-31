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
