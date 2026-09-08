import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyInputFiles, discoverUrls, downloadArtifacts, downloadHeaders } from "../src/lib/files.js";
import { ReplicateHttpClient } from "../src/lib/api-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("file utilities", () => {
  it.each([
    "https://example.test/image.png",
    "https://replicate.delivery.example.test/image.png",
    "https://evilreplicate.delivery/image.png",
    "http://replicate.delivery/image.png"
  ])("does not send credentials to %s", (url) => {
    expect(downloadHeaders(url, "test-token")).toBeUndefined();
  });

  it.each(["https://replicate.delivery/a.png", "https://pbxt.replicate.delivery/a.png", "https://api.replicate.com/v1/files/a"])(
    "authenticates trusted HTTPS downloads from %s", (url) => {
      expect(new Headers(downloadHeaders(url, "test-token")).get("authorization")).toBe("Bearer test-token");
    }
  );

  it("keeps artifact files in the output directory and redacts manifest inputs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replicate-artifact-"));
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("image", { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);
    try {
      const artifacts = await downloadArtifacts({
        output: "https://external.test/image.png", predictionId: "../outside", outputDir: dir,
        token: "test-token", manifest: { input: { api_key: "private-api-key", prompt: "hello" } }
      });
      expect(dirname(artifacts[0]!.path)).toBe(dir);
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
      expect(await readFile(artifacts[0]!.path, "utf8")).toBe("image");
      const manifest = await readFile(join(dir, "manifest.json"), "utf8");
      expect(manifest).not.toContain("private-api-key");
      expect(JSON.parse(manifest).input.prompt).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("applies nested file inputs and rejects dangerous keys before uploading", async () => {
    const client = new ReplicateHttpClient();
    await expect(applyInputFiles(client, { nested: { prompt: "hello" } }, ["nested.image=https://example.test/a.png"])).resolves.toEqual({
      nested: { prompt: "hello", image: "https://example.test/a.png" }
    });
    await expect(applyInputFiles(client, {}, ["__proto__.image=./does-not-exist.png"])).rejects.toMatchObject({ code: "invalid_key" });
  });

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
