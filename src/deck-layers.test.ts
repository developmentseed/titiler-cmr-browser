import { afterEach, describe, expect, it, vi } from "vitest";
import { dump } from "npyjs";
import { createBandTileCache } from "./band-cache";
import { DATASETS } from "./config";
import type { CollectionConfig, DatasetConfig, RenderConfig } from "./config";
import type { ControlState } from "./controls";
import { createDeckLayers } from "./deck-layers";
import * as gpuRender from "./gpu-render";
import { deriveRasterState } from "./state";

class TestImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

globalThis.ImageData ??= TestImageData as typeof ImageData;

type LayerWithProps = {
  id: string;
  props: {
    minZoom?: number;
    maxZoom?: number;
    updateTriggers: { renderTile: unknown[] };
    getTileData: (tile: unknown, options: unknown) => Promise<unknown>;
    renderTile: (tile: unknown) => unknown;
  };
};

function getDataset(id: string): DatasetConfig {
  const dataset = DATASETS.find((item) => item.id === id);
  if (!dataset) {
    throw new Error(`Missing dataset: ${id}`);
  }
  return dataset;
}

function getCollections(dataset: DatasetConfig): CollectionConfig[] {
  return Array.isArray(dataset.collection) ? dataset.collection : [dataset.collection];
}

function getCollection(datasetId: string, labelIncludes?: string): CollectionConfig {
  const collection = getCollections(getDataset(datasetId)).find((item) =>
    labelIncludes ? item.label.includes(labelIncludes) : true,
  );
  if (!collection) {
    throw new Error(`Missing collection for dataset: ${datasetId}`);
  }
  return collection;
}

function getRender(collection: CollectionConfig, label: string): RenderConfig {
  const render = collection.renders.find((item) => item.label === label);
  if (!render) {
    throw new Error(`Missing render: ${label}`);
  }
  return render;
}

function makeState(args: {
  datasetId: string;
  collectionLabelIncludes?: string;
  renderLabel: string;
  datetime: string;
  extraParams?: Record<string, string | string[]>;
}): ControlState {
  const collection = getCollection(args.datasetId, args.collectionLabelIncludes);
  return {
    collection,
    render: getRender(collection, args.renderLabel),
    datetime: args.datetime,
    extraParams: args.extraParams ?? {},
  };
}

const descriptorStub = {
  projectTo3857: (x: number, y: number) => [x, y],
  projectFrom3857: (x: number, y: number) => [x, y],
  projectTo4326: (x: number, y: number) => [x, y],
  projectFrom4326: (x: number, y: number) => [x, y],
} as never;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createDeckLayers", () => {
  it("builds zoom-gated RasterTileLayers for derived sub-layers", () => {
    const rasterState = deriveRasterState(
      makeState({
        datasetId: "nisar-gcov",
        renderLabel: "Balanced Dual-Pol RGB",
        datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
      }),
    );

    const layers = createDeckLayers(rasterState, descriptorStub) as unknown as LayerWithProps[];

    expect(layers).toHaveLength(2);
    expect(layers.map((layer) => layer.props.minZoom)).toEqual([6, 10]);
    expect(layers.map((layer) => layer.props.maxZoom)).toEqual([10, 13]);
  });

  it("recreates layer identity across style-only changes so GPU pipeline updates apply immediately", () => {
    const base = deriveRasterState(
      makeState({
        datasetId: "nisar-gcov",
        renderLabel: "Custom RGB Composite",
        datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
        extraParams: {
          rgb_r: "hh",
          rgb_g: "hv",
          rgb_b: "ratio",
        },
      }),
    );
    const variant = deriveRasterState(
      makeState({
        datasetId: "nisar-gcov",
        renderLabel: "Custom RGB Composite",
        datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
        extraParams: {
          rgb_r: "ratio",
          rgb_g: "hh",
          rgb_b: "hv",
        },
      }),
    );

    const baseLayers = createDeckLayers(base, descriptorStub) as unknown as LayerWithProps[];
    const variantLayers = createDeckLayers(variant, descriptorStub) as unknown as LayerWithProps[];

    expect(baseLayers.map((layer) => layer.id)).not.toEqual(variantLayers.map((layer) => layer.id));
    expect(baseLayers[0].props.updateTriggers.renderTile).not.toEqual(
      variantLayers[0].props.updateTriggers.renderTile,
    );
  });

  it("falls back to scalar CPU rendering with the configured colormap when GPU rendering fails", () => {
    vi.spyOn(gpuRender, "renderTileWithGpuModules").mockImplementation(() => {
      throw new Error("gpu failed");
    });

    const [layer] = createDeckLayers(
      deriveRasterState(
        makeState({
          datasetId: "mur-sst",
          renderLabel: "Sea Surface Temperature",
          datetime: "2026-05-19T00:00:00Z/2026-05-19T23:59:59Z",
        }),
      ),
      descriptorStub,
    ) as unknown as LayerWithProps[];

    const rendered = layer.props.renderTile({
      device: {} as never,
      width: 1,
      height: 1,
      byteLength: 4,
      bandTextures: [],
      cpuColormapLut: (() => {
        const lut = new Uint8ClampedArray(256 * 4);
        const offset = 16 * 4;
        lut[offset] = 12;
        lut[offset + 1] = 34;
        lut[offset + 2] = 56;
        lut[offset + 3] = 255;
        return lut;
      })(),
      ndarray: {
        data: new Float32Array([273.15]),
        dtype: "f4",
        shape: [1, 1],
        fortranOrder: false,
        width: 1,
        height: 1,
        bandCount: 1,
        byteLength: 4,
      },
    }) as { image: ImageData };

    expect(Array.from(rendered.image.data)).toEqual([12, 34, 56, 255]);
  });

  it("reuses overlapping cached bands across HLS render changes and fetches only the missing band", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const asset = url.searchParams.get("assets");
      const valuesByAsset: Record<string, number[]> = {
        B04: [1, 2, 3, 4],
        B03: [5, 6, 7, 8],
        B02: [9, 10, 11, 12],
        B05: [13, 14, 15, 16],
      };

      const values = valuesByAsset[asset ?? ""];
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => dump([...values, 255, 255, 255, 255], [2, 2, 2], { dtype: "u1" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const datetime = "2026-04-01T00:00:00Z/2026-04-30T23:59:59Z";
    const cache = createBandTileCache();
    const trueColor = createDeckLayers(
      deriveRasterState(
        makeState({
          datasetId: "hls",
          collectionLabelIncludes: "Landsat",
          renderLabel: "True Color",
          datetime,
        }),
      ),
      descriptorStub,
      undefined,
      cache,
    ) as unknown as LayerWithProps[];
    const falseColor = createDeckLayers(
      deriveRasterState(
        makeState({
          datasetId: "hls",
          collectionLabelIncludes: "Landsat",
          renderLabel: "False Color (NIR)",
          datetime,
        }),
      ),
      descriptorStub,
      undefined,
      cache,
    ) as unknown as LayerWithProps[];
    const tile = { index: { z: 5, x: 9, y: 12 } };

    await trueColor[0].props.getTileData(tile, {});
    await falseColor[0].props.getTileData(tile, {});

    const requestedAssets = fetchMock.mock.calls.map(([input]) =>
      new URL(String(input)).searchParams.get("assets"),
    );

    expect(requestedAssets).toEqual(["B04", "B03", "B02", "B05"]);
    expect(requestedAssets.filter((asset) => asset === "B03")).toHaveLength(1);
    expect(requestedAssets.filter((asset) => asset === "B02")).toHaveLength(1);
  });
});
