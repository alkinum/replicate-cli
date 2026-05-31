import { describe, expect, it } from "vitest";
import { discoverUrls, downloadArtifacts } from "../src/lib/files.js";

describe("file utilities", () => {
  it("discovers nested output URLs", () => {
    expect(
      discoverUrls({
        image: "https://replicate.delivery/a.webp",
        nested: ["nope", { video: "https://replicate.delivery/b.mp4" }]
      })
    ).toEqual([
      { path: "output.image", url: "https://replicate.delivery/a.webp" },
      { path: "output.nested.1.video", url: "https://replicate.delivery/b.mp4" }
    ]);
  });

  it("rejects artifact downloads when no URLs are present", async () => {
    await expect(
      downloadArtifacts({
        output: { text: "hello" },
        predictionId: "abc",
        outputDir: "."
      })
    ).rejects.toMatchObject({ code: "artifact_urls_missing" });
  });
});
