import { describe, expect, it } from "vitest";
import { dump } from "npyjs";
import {
  assembleBandTiles,
  decodeNpyTile,
  getTileShape,
} from "./tile-data";

describe("tile-data", () => {
  it("decodes scalar [height,width] ndarray tiles", async () => {
    const buffer = dump([1, 2, 3, 4], [2, 2], { dtype: "u2" });
    const tile = await decodeNpyTile(buffer);

    expect(tile.shape).toEqual([2, 2]);
    expect(tile.width).toBe(2);
    expect(tile.height).toBe(2);
    expect(tile.bandCount).toBe(1);
    expect(tile.dtype).toBe("u2");
    expect(Array.from(tile.data)).toEqual([1, 2, 3, 4]);
  });

  it("decodes banded [band,height,width] ndarray tiles", async () => {
    const buffer = dump([1, 2, 3, 4, 5, 6, 7, 8], [2, 2, 2], { dtype: "i2" });
    const tile = await decodeNpyTile(buffer);

    expect(tile.shape).toEqual([2, 2, 2]);
    expect(tile.width).toBe(2);
    expect(tile.height).toBe(2);
    expect(tile.bandCount).toBe(2);
    expect(tile.dtype).toBe("i2");
    expect(Array.from(tile.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("assembles multiple cached single-band tiles into one RGB-ready tile", async () => {
    const tiles = await Promise.all([
      decodeNpyTile(dump([1, 2, 3, 4], [2, 2], { dtype: "u2" })),
      decodeNpyTile(dump([5, 6, 7, 8], [2, 2], { dtype: "u2" })),
      decodeNpyTile(dump([9, 10, 11, 12], [2, 2], { dtype: "u2" })),
    ]);

    const assembled = assembleBandTiles(tiles);

    expect(assembled.shape).toEqual([3, 2, 2]);
    expect(assembled.bandCount).toBe(3);
    expect(assembled.dtype).toBe("u2");
    expect(Array.from(assembled.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("assembles rasterio-style data-plus-alpha fetch units into RGB plus a conservative shared alpha", async () => {
    const tiles = await Promise.all([
      decodeNpyTile(dump([1, 2, 3, 4, 100, 101, 0, 103], [2, 2, 2], { dtype: "u2" })),
      decodeNpyTile(dump([5, 6, 7, 8, 99, 101, 102, 103], [2, 2, 2], { dtype: "u2" })),
      decodeNpyTile(dump([9, 10, 11, 12, 100, 80, 102, 90], [2, 2, 2], { dtype: "u2" })),
    ]);

    const assembled = assembleBandTiles(tiles);

    expect(assembled.shape).toEqual([4, 2, 2]);
    expect(assembled.bandCount).toBe(4);
    expect(Array.from(assembled.data)).toEqual([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      99, 80, 0, 90,
    ]);
  });

  it("assembles a single scalar band tile without forcing a band axis", async () => {
    const tile = await decodeNpyTile(dump([1, 2, 3, 4], [2, 2], { dtype: "f4" }));

    const assembled = assembleBandTiles([tile]);

    expect(assembled.shape).toEqual([2, 2]);
    expect(assembled.bandCount).toBe(1);
    expect(assembled.dtype).toBe("f4");
    expect(Array.from(assembled.data)).toEqual([1, 2, 3, 4]);
  });

  it("widens mixed dtypes during assembly", async () => {
    const assembled = assembleBandTiles([
      await decodeNpyTile(dump([1, 2, 3, 4], [2, 2], { dtype: "u2" })),
      await decodeNpyTile(dump([1.5, 2.5, 3.5, 4.5], [2, 2], { dtype: "f8" })),
    ]);

    expect(assembled.dtype).toBe("f4");
    expect(assembled.data).toBeInstanceOf(Float32Array);
    expect(Array.from(assembled.data)).toEqual([1, 2, 3, 4, 1.5, 2.5, 3.5, 4.5]);
  });

  it("rejects incompatible shapes during assembly", async () => {
    const first = await decodeNpyTile(dump([1, 2, 3, 4], [2, 2], { dtype: "u1" }));
    const second = await decodeNpyTile(dump([1, 2, 3, 4, 5, 6], [2, 3], { dtype: "u1" }));

    expect(() => assembleBandTiles([first, second])).toThrow(/different shapes/);
  });

  it("throws on unsupported ndarray shapes", () => {
    expect(() => getTileShape([2, 3, 4, 5])).toThrow(/Unsupported ndarray shape/);
  });
});
