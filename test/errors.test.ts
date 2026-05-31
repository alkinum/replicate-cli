import { describe, expect, it } from "vitest";
import { redactDeep } from "../src/lib/errors.js";

describe("error redaction", () => {
  it("does not redact ordinary error text that mentions tokens", () => {
    expect(redactDeep("You did not pass an authentication token")).toBe(
      "You did not pass an authentication token"
    );
  });

  it("redacts token-like values and sensitive fields", () => {
    expect(redactDeep("r8_abcdefghijklmnopqrstuvwxyz")).toBe("r8_a...wxyz");
    expect(redactDeep({ token: "secret-value" })).toEqual({ token: "secr...alue" });
  });
});
