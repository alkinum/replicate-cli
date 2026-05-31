import { describe, expect, it, vi } from "vitest";
import { collectPaginatedResults, requestPaginated } from "../src/commands/shared.js";

describe("pagination helper", () => {
  it("follows next links until the requested limit is reached", async () => {
    const request = vi.fn(async (_method: string, path: string) => ({
      data:
        path === "/page-2"
          ? { next: "/page-3", results: [{ id: 3 }, { id: 4 }] }
          : { next: "/page-2", results: [{ id: 1 }, { id: 2 }] },
      headers: new Headers(),
      status: 200
    }));

    const data = await requestPaginated({ request } as any, "/page-1", { limit: "3" });

    expect(data.results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(data.next).toBe("/page-3");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid limits before making a request", async () => {
    const request = vi.fn();
    await expect(requestPaginated({ request } as any, "/page-1", { limit: "nope" })).rejects.toMatchObject({
      code: "invalid_limit"
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("continues from an existing paginated response", async () => {
    const request = vi.fn(async () => ({
      data: { next: null, results: [{ id: 3 }] },
      headers: new Headers(),
      status: 200
    }));

    const data = await collectPaginatedResults(
      { request } as any,
      { next: "/page-2", results: [{ id: 1 }, { id: 2 }] },
      3
    );

    expect(data.results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(request).toHaveBeenCalledWith("GET", "/page-2");
  });
});
