import { describe, expect, it } from "vitest";
import { simplifyOpenApiSchema, validateInputAgainstOpenApiSchema } from "../src/lib/schema.js";

describe("schema simplifier", () => {
  it("rejects null for non-nullable fields while accepting explicit nullable schemas", () => {
    const schema = { properties: {
      prompt: { type: "string" },
      optional: { type: "integer" },
      nullable: { type: ["string", "null"] },
      nullOnly: { type: "null" },
      composed: { anyOf: [{ type: "string" }, { type: "null" }] }
    }, required: ["prompt"] };
    expect(validateInputAgainstOpenApiSchema(schema, {
      prompt: null, optional: null, nullable: null, nullOnly: null, composed: null
    })).toMatchObject([{ field: "optional", code: "type" }, { field: "prompt", code: "type" }]);
  });

  it("resolves sibling uses of a shared ref without treating them as cycles", () => {
    const schema = { components: { schemas: {
      Choice: { type: "string", enum: ["fast"] },
      Input: { properties: { mode: { anyOf: [
        { type: "array", items: { $ref: "#/components/schemas/Choice" } },
        { $ref: "#/components/schemas/Choice" }
      ] } } }
    } } };
    expect(simplifyOpenApiSchema(schema)).toMatchObject([{ name: "mode", type: "union" }]);
  });

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
      { name: "prompt", type: "string", required: true, file: false },
      { name: "num_outputs", type: "integer", default: 1, minimum: 1, maximum: 4 },
      { name: "image", type: "string", file: true }
    ]);
  });

  it("resolves composed refs used by current Replicate model schemas", () => {
    const schema = {
      components: {
        schemas: {
          Input: {
            required: ["prompt"],
            properties: {
              prompt: {
                type: "string",
                description: "A text description of the desired image",
                "x-order": 0
              },
              aspect_ratio: {
                allOf: [{ $ref: "#/components/schemas/aspect_ratio" }],
                default: "1:1",
                "x-order": 1
              },
              input_images: {
                type: "array",
                items: {
                  type: "string",
                  format: "uri"
                },
                default: [],
                "x-order": 2
              },
              user_id: {
                type: "string",
                nullable: true,
                "x-order": 3
              }
            }
          },
          aspect_ratio: {
            type: "string",
            enum: ["1:1", "3:2", "2:3"]
          }
        }
      }
    };

    expect(simplifyOpenApiSchema(schema)).toMatchObject([
      { name: "prompt", type: "string", file: false },
      { name: "aspect_ratio", type: "string", enum: ["1:1", "3:2", "2:3"], file: false },
      { name: "input_images", type: "array", file: true },
      { name: "user_id", type: "string", nullable: true }
    ]);
    expect(
      validateInputAgainstOpenApiSchema(schema, {
        prompt: "hello",
        aspect_ratio: "1:1",
        input_images: ["https://example.com/image.png"],
        user_id: null
      })
    ).toEqual([]);
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
