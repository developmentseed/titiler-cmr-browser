import { afterEach, describe, expect, it, vi } from "vitest";
import { dump } from "npyjs";
import { createBandTileCache } from "./band-cache";
import {
  buildRawTileUrl,
  getTileData,
  loadWebMercatorQuadDescriptor,
  type TileIndexLike,
} from "./titiler-cmr";
import type { ActiveSourceDefinition, RawBandRequestSpec } from "./state";

function makeBandRequest(bandRef: string, suffix = bandRef): RawBandRequestSpec {
  return {
    bandKey: bandRef,
    bandRef,
    bandRequestKey: `band:${suffix}`,
  };
}

function makeSource(args: {
  backend: ActiveSourceDefinition["backend"];
  collectionConceptId: string;
  datetime: string;
  assets?: string[];
  variables?: string[];
  rawBandRequests: RawBandRequestSpec[];
  params?: Record<string, string | string[]>;
}): ActiveSourceDefinition {
  return {
    sourceKey: "source-key",
    backend: args.backend,
    collectionConceptId: args.collectionConceptId,
    datetime: args.datetime,
    assets: args.assets,
    variables: args.variables,
    rawBandRequests: args.rawBandRequests,
    params: args.params ?? {},
    minzoom: 0,
    attribution: "example",
  };
}

function getCacheKey(tile: TileIndexLike, bandRequest: RawBandRequestSpec): string {
  const { z, x, y } = tile.index;
  return `${bandRequest.bandRequestKey}/${z}/${x}/${y}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("titiler-cmr", () => {
  it("builds raw tile URLs from source params only", () => {
    const url = buildRawTileUrl("https://example.test/api", "rasterio", 5, 9, 12, {
      collection_concept_id: "C123",
      datetime: "2026-04-01T00:00:00Z/2026-04-30T23:59:59Z",
      assets: ["B04", "B03", "B02"],
      attribute: ["a", "b"],
      expression: "b1/b2",
      rescale: ["0,1"],
      colormap_name: "viridis",
      color_formula: "Gamma RGB 2.5",
    });

    expect(url).toContain("/rasterio/tiles/WebMercatorQuad/5/9/12.npy?");
    expect(url).toContain("collection_concept_id=C123");
    expect(url).toContain("assets=B04");
    expect(url).toContain("assets=B03");
    expect(url).toContain("assets=B02");
    expect(url).toContain("attribute=a");
    expect(url).toContain("attribute=b");
    expect(url).toContain("expression=b1%2Fb2");
    expect(url).toContain("rescale=0%2C1");
    expect(url).not.toContain("colormap_name=");
    expect(url).not.toContain("color_formula=");
  });

  it("synthesizes a world bounding box when the TMS payload omits one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "WebMercatorQuad",
          crs: "http://www.opengis.net/def/crs/EPSG/0/3857",
          tileMatrices: [
            {
              id: "0",
              scaleDenominator: 559082264.0287178,
              cellSize: 156543.03392804097,
              cornerOfOrigin: "topLeft",
              pointOfOrigin: [-20037508.342789244, 20037508.342789244],
              tileWidth: 256,
              tileHeight: 256,
              matrixWidth: 1,
              matrixHeight: 1,
            },
          ],
        }),
      }),
    );

    const descriptor = await loadWebMercatorQuadDescriptor("https://example.test/api");

    expect(descriptor.projectedBounds).toEqual([
      -20037508.342789244,
      -20037508.342789244,
      20037508.342789244,
      20037508.342789244,
    ]);
  });

  it("fetches and assembles band tiles with request tracking", async () => {
    const tracker = {
      start: vi.fn(),
      finish: vi.fn(),
    };
    const tileBuffer = dump([1, 2, 3, 4], [2, 2], { dtype: "u1" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => tileBuffer,
      }),
    );

    const source = makeSource({
      backend: "xarray",
      collectionConceptId: "C1996881146-POCLOUD",
      datetime: "2026-05-19T00:00:00Z/2026-05-19T23:59:59Z",
      variables: ["analysed_sst"],
      rawBandRequests: [makeBandRequest("analysed_sst")],
    });
    const tile: TileIndexLike = {
      index: { z: 2, x: 1, y: 1 },
    };

    const data = await getTileData(tile, {} as Parameters<typeof getTileData>[1], source, tracker, createBandTileCache());

    expect(data).not.toBeNull();
    expect(data?.width).toBe(2);
    expect(data?.height).toBe(2);
    expect(data?.ndarray.shape).toEqual([2, 2]);
    expect(Array.from(data?.ndarray.data ?? [])).toEqual([1, 2, 3, 4]);
    expect(tracker.start).toHaveBeenCalledOnce();
    expect(tracker.finish).toHaveBeenCalledWith("ok");
  });

  it("fetches only missing bands during assembly", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const asset = url.searchParams.get("assets");
      const valuesByAsset: Record<string, number[]> = {
        B04: [1, 2, 3, 4],
        B03: [5, 6, 7, 8],
        B02: [9, 10, 11, 12],
      };

      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => dump(valuesByAsset[asset ?? ""], [2, 2], { dtype: "u1" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const tile: TileIndexLike = {
      index: { z: 5, x: 9, y: 12 },
    };
    const rawBandRequests = [makeBandRequest("B04"), makeBandRequest("B03"), makeBandRequest("B02")];
    const source = makeSource({
      backend: "rasterio",
      collectionConceptId: "C2021957295-LPCLOUD",
      datetime: "2026-04-01T00:00:00Z/2026-04-30T23:59:59Z",
      assets: ["B04", "B03", "B02"],
      rawBandRequests,
      params: { assets_regex: "B[0-9][0-9A-Za-z]" },
    });
    const cache = createBandTileCache();
    cache.set(getCacheKey(tile, rawBandRequests[1]), {
      ndarray: {
        data: new Uint8Array([5, 6, 7, 8]),
        dtype: "u1",
        shape: [2, 2],
        fortranOrder: false,
        width: 2,
        height: 2,
        bandCount: 1,
        byteLength: 4,
      },
    });
    cache.set(getCacheKey(tile, rawBandRequests[2]), {
      ndarray: {
        data: new Uint8Array([9, 10, 11, 12]),
        dtype: "u1",
        shape: [2, 2],
        fortranOrder: false,
        width: 2,
        height: 2,
        bandCount: 1,
        byteLength: 4,
      },
    });

    const data = await getTileData(tile, {} as Parameters<typeof getTileData>[1], source, undefined, cache);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("assets=B04");
    expect(data?.ndarray.shape).toEqual([3, 2, 2]);
    expect(Array.from(data?.ndarray.data ?? [])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("returns null for empty 204 tiles instead of trying to decode them", async () => {
    const tracker = {
      start: vi.fn(),
      finish: vi.fn(),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      }),
    );

    const source = makeSource({
      backend: "rasterio",
      collectionConceptId: "C2021957295-LPCLOUD",
      datetime: "2026-04-01T00:00:00Z/2026-04-30T23:59:59Z",
      assets: ["B04"],
      rawBandRequests: [makeBandRequest("B04")],
      params: { exitwhenfull: "true", assets_regex: "B[0-9][0-9A-Za-z]" },
    });
    const tile: TileIndexLike = {
      index: { z: 2, x: 0, y: 3 },
    };

    await expect(
      getTileData(tile, {} as Parameters<typeof getTileData>[1], source, tracker, createBandTileCache()),
    ).resolves.toBeNull();
    expect(tracker.start).toHaveBeenCalledOnce();
    expect(tracker.finish).toHaveBeenCalledWith("ok");
  });

  it("marks aborted band loads as aborted without poisoning future retries", async () => {
    const tracker = {
      start: vi.fn(),
      finish: vi.fn(),
    };
    const aborted = new Error("aborted");
    aborted.name = "AbortError";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));

    const source = makeSource({
      backend: "xarray",
      collectionConceptId: "C1996881146-POCLOUD",
      datetime: "2026-05-19T00:00:00Z/2026-05-19T23:59:59Z",
      variables: ["analysed_sst"],
      rawBandRequests: [makeBandRequest("analysed_sst")],
    });
    const tile: TileIndexLike = {
      index: { z: 2, x: 1, y: 1 },
    };

    await expect(
      getTileData(tile, {} as Parameters<typeof getTileData>[1], source, tracker, createBandTileCache()),
    ).rejects.toThrow("aborted");
    expect(tracker.start).toHaveBeenCalledOnce();
    expect(tracker.finish).toHaveBeenCalledWith("aborted");
  });
});
