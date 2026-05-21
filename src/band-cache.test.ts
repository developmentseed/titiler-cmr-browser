import { describe, expect, it, vi } from "vitest";
import { createBandTileCache, type CachedBandTile } from "./band-cache";

function makeCachedBandTile(value: number): CachedBandTile {
  return {
    ndarray: {
      data: new Uint8Array([value, value, value, value]),
      dtype: "u1",
      shape: [2, 2],
      fortranOrder: false,
      width: 2,
      height: 2,
      bandCount: 1,
      byteLength: 4,
    },
  };
}

describe("band-cache", () => {
  it("returns an existing tile on cache hit", async () => {
    const cache = createBandTileCache();
    const value = makeCachedBandTile(7);

    cache.set("band-key", value);

    await expect(cache.getOrLoad("band-key", vi.fn())).resolves.toBe(value);
    expect(cache.get("band-key")).toBe(value);
  });

  it("coalesces concurrent getOrLoad calls for the same key", async () => {
    const cache = createBandTileCache();
    const loader = vi.fn(async () => makeCachedBandTile(3));

    const [first, second] = await Promise.all([
      cache.getOrLoad("band-key", loader),
      cache.getOrLoad("band-key", loader),
    ]);

    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("allows retry after a failed load", async () => {
    const cache = createBandTileCache();
    const loader = vi
      .fn<() => Promise<CachedBandTile>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeCachedBandTile(9));

    await expect(cache.getOrLoad("band-key", loader)).rejects.toThrow("boom");
    await expect(cache.getOrLoad("band-key", loader)).resolves.toMatchObject({
      ndarray: { shape: [2, 2] },
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
