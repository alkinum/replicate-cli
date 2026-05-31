import { describe, expect, it } from "vitest";
import { simplifyOpenApiSchema } from "../src/lib/schema.js";

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
});
