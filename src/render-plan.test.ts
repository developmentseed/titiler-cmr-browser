import { describe, expect, it } from "vitest";
import { DATASETS } from "./config";
import type { CollectionConfig, DatasetConfig, RenderConfig } from "./config";
import type { ControlState } from "./controls";
import { compileRenderPlan } from "./render-plan";
import { deriveClientRenderPlan } from "./state";
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

describe("compileRenderPlan", () => {
  it("compiles scalar styles", () => {
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

    expect(compiled.expression).toEqual({
      op: "sub",
      args: [
        { op: "band", band: 1 },
        { op: "const", value: 273.15 },
      ],
    });
    expect(compiled.rescale).toEqual([-2, 29]);
    expect(compiled.colormapName).toBe("nipy_spectral");
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
    expect(compiled.adjustments).toEqual([
      { kind: "gamma", value: 3.5 },
      { kind: "saturation", value: 1.2 },
      { kind: "sigmoidal", contrast: 15, bias: 0.35 },
    ]);
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
