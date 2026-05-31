import { describe, expect, it } from "vitest";
import { simplifyOpenApiSchema, validateInputAgainstOpenApiSchema } from "../src/lib/schema.js";

describe("schema simplifier", () => {
  it("extracts ordered input fields", () => {
    const schema = {
      components: {
        schemas: {
          Input: {
            required: ["prompt"],
            properties: {
              prompt: {
                type: "string",
                description: "Prompt",
                "x-order": 0
              },
              num_outputs: {
                type: "integer",
                default: 1,
                minimum: 1,
                maximum: 4,
                "x-order": 1
              },
              image: {
                type: "string",
                format: "uri",
                description: "Input image"
              }
            }
          }
        }
      }
    };

    expect(simplifyOpenApiSchema(schema)).toMatchObject([
      { name: "prompt", type: "string", required: true },
      { name: "num_outputs", type: "integer", default: 1, minimum: 1, maximum: 4 },
      { name: "image", type: "string", file: true }
    ]);
  });

  it("validates required fields, types, enums, and numeric ranges", () => {
    const schema = {
      components: {
        schemas: {
          Input: {
            required: ["prompt"],
            properties: {
              prompt: { type: "string" },
              mode: { type: "string", enum: ["fast", "quality"] },
              steps: { type: "integer", minimum: 1, maximum: 4 }
            }
          }
        }
      }
    };

    expect(
      validateInputAgainstOpenApiSchema(schema, {
        mode: "slow",
        steps: 5
      })
    ).toMatchObject([
      { field: "mode", code: "enum" },
      { field: "prompt", code: "required" },
      { field: "steps", code: "maximum" }
    ]);
  });

  it("accepts dry-run local file previews for file fields", () => {
    const schema = {
      components: {
        schemas: {
          Input: {
            properties: {
              image: {
                type: "string",
                format: "uri",
                description: "Input image"
              }
            }
          }
        }
      }
    };

    expect(
      validateInputAgainstOpenApiSchema(schema, {
        image: { file: "/tmp/input.png", mode: "auto" }
      })
    ).toEqual([]);
  });
});
