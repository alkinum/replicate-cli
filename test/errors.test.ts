import { describe, expect, it } from "vitest";
import { redactDeep } from "../src/lib/errors.js";
import { errorEnvelope } from "../src/lib/output.js";

describe("error redaction", () => {
  it("redacts every token in error messages without dropping context", () => {
    const first = "r8_abcdefghijklmnopqrstuvwxyz";
    const second = "r8_1234567890abcdefghij";
    expect(errorEnvelope(new Error(`Rejected ${first} and ${second}`)).error.message).toBe(
      "Rejected r8_a...wxyz and r8_1...ghij"
    );
  });

  it("does not redact ordinary error text that mentions tokens", () => {
    expect(redactDeep("You did not pass an authentication token")).toBe(
      "You did not pass an authentication token"
    );
  });

  it("redacts token-like values and sensitive fields", () => {
    expect(redactDeep("r8_abcdefghijklmnopqrstuvwxyz")).toBe("r8_a...wxyz");
    expect(redactDeep({ token: "secret-value" })).toEqual({ token: "secr...alue" });
  });

  it("does not redact schema descriptors for sensitive input names", () => {
    expect(
      redactDeep({
        properties: {
          openai_api_key: {
            type: "string",
            format: "password",
            description: "Optional API key",
            "x-cog-secret": true
          }
        }
      })
    ).toEqual({
      properties: {
        openai_api_key: {
          type: "string",
          format: "password",
          description: "Optional API key",
          "x-cog-secret": true
        }
      }
    });
  });
});
