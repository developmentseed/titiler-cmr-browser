import { describe, expect, it } from "vitest";
import { DATASETS } from "./config";
import type { CollectionConfig, DatasetConfig, RenderConfig } from "./config";
import type { ControlState } from "./controls";
import { renderTileWithGpuModules } from "./gpu-render";
import { compileRenderPlan } from "./render-plan";
import { deriveClientRenderPlan } from "./state";
import type { GpuTileData } from "./titiler-cmr";

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

function makeTile(bandCount = 1): GpuTileData {
  const texture = { destroy() {} } as never;
  return {
    device: {} as never,
    width: 2,
    height: 2,
    byteLength: 16 * bandCount,
    ndarray: {
      data: new Float32Array(4 * bandCount).fill(1),
      dtype: "f4",
      shape: bandCount === 1 ? [2, 2] : [bandCount, 2, 2],
      fortranOrder: false,
      width: 2,
      height: 2,
      bandCount,
      byteLength: 16 * bandCount,
    },
    bandTextures: Array.from({ length: bandCount }, () => texture),
  };
}

describe("renderTileWithGpuModules", () => {
  it("includes isnan/isinf early-return in scalar pipeline to make xarray NaN fill values transparent", () => {
    const compiled = compileRenderPlan(
      deriveClientRenderPlan(
        makeState({
          datasetId: "micasa",
          renderLabel: "Net Primary Productivity (NPP)",
          datetime: "2024-12-31T00:00:00Z/2024-12-31T23:59:59Z",
        }),
      ),
    );

    expect(compiled.kind).toBe("scalar");
    const tileWithColormap = { ...makeTile(), colormapTexture: { destroy() {} } as never };
    const { renderPipeline } = renderTileWithGpuModules(tileWithColormap, compiled);
    const exprModule = renderPipeline[0]?.module;
    const filterCode = exprModule?.inject?.["fs:DECKGL_FILTER_COLOR"] ?? "";
    expect(filterCode).toMatch(/isnan\(scalar\)/);
    expect(filterCode).toMatch(/isinf\(scalar\)/);
    expect(filterCode).toMatch(/color\s*=\s*vec4\(0\.0,\s*0\.0,\s*0\.0,\s*0\.0\)/);
    expect(filterCode).toMatch(/\breturn\b/);
  });

  it("supports RGB plans with independent per-channel rescale ranges on the GPU", () => {
    const compiled = compileRenderPlan(
      deriveClientRenderPlan(
        makeState({
          datasetId: "nisar-gcov",
          renderLabel: "Balanced Dual-Pol RGB",
          datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
        }),
      ),
    );

    expect(compiled.kind).toBe("rgb");
    const { renderPipeline } = renderTileWithGpuModules(makeTile(2), compiled);
    const rescaleModule = renderPipeline[1]?.module;
    const filterCode = rescaleModule?.inject?.["fs:DECKGL_FILTER_COLOR"] ?? "";
    expect(filterCode).toMatch(/rgbPerChannelRescale/);
    expect(renderPipeline[1]?.props).toMatchObject({
      rescaleMin: [-20, -30, 2],
      rescaleMax: [0, 5, 18],
    });
  });

  it("supports selector-driven RGB plans with different per-channel rescale ranges on the GPU", () => {
    const compiled = compileRenderPlan(
      deriveClientRenderPlan(
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
      ),
    );

    expect(compiled.kind).toBe("rgb");
    const { renderPipeline } = renderTileWithGpuModules(makeTile(2), compiled);
    expect(renderPipeline[1]?.props).toMatchObject({
      rescaleMin: [2, -20, -30],
      rescaleMax: [18, 0, 5],
    });
  });

  it("uses positive alpha-mask filtering for RGB plans with an alpha band", () => {
    const compiled = compileRenderPlan(
      deriveClientRenderPlan(
        makeState({
          datasetId: "hls",
          renderLabel: "True Color",
          datetime: "2026-04-01T00:00:00Z/2026-04-30T23:59:59Z",
        }),
      ),
    );

    expect(compiled.kind).toBe("rgb");
    const { renderPipeline } = renderTileWithGpuModules(makeTile(4), compiled);
    const maskModule = renderPipeline[1]?.module;
    const filterCode = maskModule?.inject?.["fs:DECKGL_FILTER_COLOR"] ?? "";
    expect(filterCode).toMatch(/maskValue > 0\.0/);
  });
});
