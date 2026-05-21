import { describe, expect, it } from "vitest";
import { DATASETS } from "./config";
import type { CollectionConfig, DatasetConfig, RenderConfig } from "./config";
import type { ControlState } from "./controls";
import { compileRenderPlan } from "./render-plan";
import { deriveClientRenderPlan } from "./state";
import type { DecodedTileData } from "./titiler-cmr";

class TestImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

globalThis.ImageData ??= TestImageData as typeof ImageData;

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

function getCollection(datasetId: string): CollectionConfig {
  return getCollections(getDataset(datasetId))[0];
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
  renderLabel: string;
  datetime: string;
  extraParams?: Record<string, string | string[]>;
}): ControlState {
  const collection = getCollection(args.datasetId);
  return {
    collection,
    render: getRender(collection, args.renderLabel),
    datetime: args.datetime,
    extraParams: args.extraParams ?? {},
  };
}

function makeMaskedHlsTile(): DecodedTileData {
  return {
    device: {} as never,
    width: 2,
    height: 1,
    byteLength: 16,
    bandTextures: [],
    ndarray: {
      data: new Int16Array([
        1000, 2000,
        1000, 2000,
        1000, 2000,
        32767, -32768,
      ]),
      dtype: "i2",
      shape: [4, 1, 2],
      fortranOrder: false,
      width: 2,
      height: 1,
      bandCount: 4,
      byteLength: 16,
    },
  };
}

function makeColormapLut(entries: Record<number, [number, number, number, number]>): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (const [indexText, rgba] of Object.entries(entries)) {
    const index = Number(indexText);
    const offset = index * 4;
    lut[offset] = rgba[0];
    lut[offset + 1] = rgba[1];
    lut[offset + 2] = rgba[2];
    lut[offset + 3] = rgba[3];
  }
  return lut;
}

describe("compileRenderPlan", () => {
  it("compiles scalar styles into expression -> rescale -> colormap steps", () => {
    const state = makeState({
      datasetId: "mur-sst",
      renderLabel: "Sea Surface Temperature",
      datetime: "2026-05-19T00:00:00Z/2026-05-19T23:59:59Z",
    });

    const compiled = compileRenderPlan(deriveClientRenderPlan(state));

    expect(compiled.kind).toBe("scalar");
    if (compiled.kind !== "scalar") {
      throw new Error("Expected scalar render plan");
    }

    expect(compiled.steps).toEqual([
      {
        kind: "expression",
        expression: {
          op: "sub",
          args: [
            { op: "band", band: 1 },
            { op: "const", value: 273.15 },
          ],
        },
      },
      { kind: "linear-rescale", range: [-2, 29] },
      { kind: "colormap", colormapName: "nipy_spectral" },
    ]);
    expect(compiled.nodata).toBe(-273.15);
  });

  it("preserves independent RGB channel expressions and selector-driven rescale metadata", () => {
    const state = makeState({
      datasetId: "nisar-gcov",
      renderLabel: "Custom RGB Composite",
      datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
      extraParams: {
        rgb_r: "ratio",
        rgb_g: "hh",
        rgb_b: "hv",
      },
    });

    const compiled = compileRenderPlan(deriveClientRenderPlan(state));

    expect(compiled.kind).toBe("rgb");
    if (compiled.kind !== "rgb") {
      throw new Error("Expected rgb render plan");
    }

    expect(compiled.channels).toEqual([
      {
        expression: {
          op: "mul",
          args: [
            { op: "const", value: 10 },
            {
              op: "log10",
              arg: {
                op: "div",
                args: [
                  { op: "band", band: 1 },
                  { op: "band", band: 2 },
                ],
              },
            },
          ],
        },
        rescale: [2, 18],
      },
      {
        expression: {
          op: "mul",
          args: [
            { op: "const", value: 10 },
            { op: "log10", arg: { op: "band", band: 1 } },
          ],
        },
        rescale: [-20, 0],
      },
      {
        expression: {
          op: "mul",
          args: [
            { op: "const", value: 10 },
            { op: "log10", arg: { op: "band", band: 2 } },
          ],
        },
        rescale: [-30, 5],
      },
    ]);
  });

  it("uses fixed HLS reflectance ranges so RGB tiles share one scale", () => {
    const state = makeState({
      datasetId: "hls",
      renderLabel: "True Color",
      datetime: "2026-04-01T00:00:00Z/2026-04-30T23:59:59Z",
    });

    const compiled = compileRenderPlan(deriveClientRenderPlan(state));

    expect(compiled.kind).toBe("rgb");
    if (compiled.kind !== "rgb") {
      throw new Error("Expected rgb render plan");
    }

    expect(compiled.channels.map((channel) => channel.rescale)).toEqual([
      [0, 32767],
      [0, 32767],
      [0, 32767],
    ]);
    expect(compiled.alphaBand).toBe(4);
  });

  it("uses the HLS mask band as alpha in CPU rendering", () => {
    const state = makeState({
      datasetId: "hls",
      renderLabel: "True Color",
      datetime: "2026-04-01T00:00:00Z/2026-04-30T23:59:59Z",
    });

    const compiled = compileRenderPlan(deriveClientRenderPlan(state));

    expect(compiled.kind).toBe("rgb");
    if (compiled.kind !== "rgb") {
      throw new Error("Expected rgb render plan");
    }

    const image = compiled.renderTile(makeMaskedHlsTile());

    expect(Array.from(image.data)).toEqual([
      145, 145, 145, 255,
      0, 0, 0, 0,
    ]);
  });

  it("renders scalar fallback pixels with the configured colormap instead of grayscale", () => {
    const state = makeState({
      datasetId: "mur-sst",
      renderLabel: "Sea Surface Temperature",
      datetime: "2026-05-19T00:00:00Z/2026-05-19T23:59:59Z",
    });

    const compiled = compileRenderPlan(deriveClientRenderPlan(state));

    expect(compiled.kind).toBe("scalar");
    if (compiled.kind !== "scalar") {
      throw new Error("Expected scalar render plan");
    }

    const image = compiled.renderTile({
      device: {} as never,
      width: 2,
      height: 1,
      byteLength: 8,
      bandTextures: [],
      cpuColormapLut: makeColormapLut({
        16: [12, 34, 56, 255],
      }),
      ndarray: {
        data: new Float32Array([273.15, 0]),
        dtype: "f4",
        shape: [1, 2],
        fortranOrder: false,
        width: 2,
        height: 1,
        bandCount: 1,
        byteLength: 8,
      },
    });

    expect(Array.from(image.data)).toEqual([
      12, 34, 56, 255,
      0, 0, 0, 0,
    ]);
  });

  it("fails explicitly when scalar CPU fallback lacks the configured colormap", () => {
    const state = makeState({
      datasetId: "mur-sst",
      renderLabel: "Sea Surface Temperature",
      datetime: "2026-05-19T00:00:00Z/2026-05-19T23:59:59Z",
    });

    const compiled = compileRenderPlan(deriveClientRenderPlan(state));

    expect(compiled.kind).toBe("scalar");
    if (compiled.kind !== "scalar") {
      throw new Error("Expected scalar render plan");
    }

    expect(() =>
      compiled.renderTile({
        device: {} as never,
        width: 1,
        height: 1,
        byteLength: 4,
        bandTextures: [],
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
      }),
    ).toThrow(/colormap lookup table/);
  });

  it("uses fixed rescale ranges for preset NISAR RGB renders so tiles share one scale", () => {
    const state = makeState({
      datasetId: "nisar-gcov",
      renderLabel: "Balanced Dual-Pol RGB",
      datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
    });

    const compiled = compileRenderPlan(deriveClientRenderPlan(state));

    expect(compiled.kind).toBe("rgb");
    if (compiled.kind !== "rgb") {
      throw new Error("Expected rgb render plan");
    }

    expect(compiled.channels.map((channel) => channel.rescale)).toEqual([
      [-20, 0],
      [-30, 5],
      [2, 18],
    ]);
  });
});
