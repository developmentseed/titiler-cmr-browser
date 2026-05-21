import { describe, expect, it } from "vitest";
import { DATASETS } from "./config";
import type { CollectionConfig, DatasetConfig, RenderConfig } from "./config";
import type { ControlState } from "./controls";
import {
  deriveActiveSources,
  deriveClientRenderPlan,
  deriveRasterState,
} from "./state";

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
  const dataset = getDataset(datasetId);
  const collection = getCollections(dataset).find((item) =>
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
  const render = getRender(collection, args.renderLabel);
  return {
    collection,
    render,
    datetime: args.datetime,
    extraParams: args.extraParams ?? {},
  };
}

describe("deriveRasterState", () => {
  it("derives HLS true-color source fetch data and RGB style adjustments", () => {
    const state = makeState({
      datasetId: "hls",
      collectionLabelIncludes: "Sentinel-2",
      renderLabel: "True Color",
      datetime: "2026-04-01T00:00:00Z/2026-04-30T23:59:59Z",
      extraParams: {
        cloud_cover: "0,15",
        sort_key: "cloud_cover",
      },
    });

    const [source] = deriveActiveSources(state);
    const style = deriveClientRenderPlan(state);

    expect(source.assets).toEqual(["B04", "B03", "B02"]);
    expect(source.rawBandRequests.map((request) => request.bandRef)).toEqual(["B04", "B03", "B02"]);
    expect(source.params).toMatchObject({
      assets_regex: "B[0-9][0-9A-Za-z]",
      cloud_cover: "0,15",
      sort_key: "cloud_cover",
      exitwhenfull: "true",
    });
    expect(style.kind).toBe("rgb");
    if (style.kind !== "rgb") {
      throw new Error("Expected rgb style plan");
    }
    expect(style.channels.map((channel) => channel.expression)).toEqual([
      { op: "band", band: 1 },
      { op: "band", band: 2 },
      { op: "band", band: 3 },
    ]);
    expect(style.adjustments).toEqual([
      { kind: "gamma", value: 3.5 },
      { kind: "saturation", value: 1.2 },
      { kind: "sigmoidal", contrast: 15, bias: 0.35 },
    ]);
  });

  it("derives MUR SST scalar style with client-side unit conversion metadata", () => {
    const state = makeState({
      datasetId: "mur-sst",
      renderLabel: "Sea Surface Temperature",
      datetime: "2026-05-19T00:00:00Z/2026-05-19T23:59:59Z",
    });

    const [source] = deriveActiveSources(state);
    const style = deriveClientRenderPlan(state);

    expect(source.variables).toEqual(["analysed_sst"]);
    expect(source.rawBandRequests.map((request) => request.bandRef)).toEqual(["analysed_sst"]);
    expect(source.params).toEqual({});
    expect(style).toMatchObject({
      kind: "scalar",
      expression: {
        op: "sub",
        args: [
          { op: "band", band: 1 },
          { op: "const", value: 273.15 },
        ],
      },
      rescale: [-2, 29],
      colormapName: "nipy_spectral",
      nodata: -273.15,
      units: "°C",
      legend: {
        kind: "colormap",
        colormapName: "nipy_spectral",
        range: [-2, 29],
        units: "°C",
      },
    });
  });

  it("treats NISAR custom RGB selector changes as style-only and keeps band requests stable", () => {
    const base = makeState({
      datasetId: "nisar-gcov",
      renderLabel: "Custom RGB Composite",
      datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
      extraParams: {
        rgb_r: "hh",
        rgb_g: "hv",
        rgb_b: "ratio",
      },
    });
    const variant = makeState({
      datasetId: "nisar-gcov",
      renderLabel: "Custom RGB Composite",
      datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
      extraParams: {
        rgb_r: "ratio",
        rgb_g: "hh",
        rgb_b: "hv",
      },
    });

    const baseSources = deriveActiveSources(base);
    const variantSources = deriveActiveSources(variant);
    const baseStyle = deriveClientRenderPlan(base);
    const variantStyle = deriveClientRenderPlan(variant);

    expect(baseSources.map((item) => item.sourceKey)).toEqual(
      variantSources.map((item) => item.sourceKey),
    );
    expect(baseSources.map((item) => item.rawBandRequests.map((request) => request.bandRequestKey))).toEqual(
      variantSources.map((item) => item.rawBandRequests.map((request) => request.bandRequestKey)),
    );
    expect(baseStyle.styleKey).not.toBe(variantStyle.styleKey);
  });

  it("treats scalar colormap changes as style-only and keeps band requests stable", () => {
    const base = makeState({
      datasetId: "mur-sst",
      renderLabel: "Sea Surface Temperature",
      datetime: "2026-05-19T00:00:00Z/2026-05-19T23:59:59Z",
    });
    const variant = makeState({
      datasetId: "mur-sst",
      renderLabel: "Sea Surface Temperature",
      datetime: "2026-05-19T00:00:00Z/2026-05-19T23:59:59Z",
      extraParams: {
        colormap: "turbo",
      },
    });

    expect(deriveActiveSources(base).map((item) => item.sourceKey)).toEqual(
      deriveActiveSources(variant).map((item) => item.sourceKey),
    );
    expect(deriveClientRenderPlan(base).styleKey).not.toBe(deriveClientRenderPlan(variant).styleKey);
    expect(deriveClientRenderPlan(variant)).toMatchObject({
      kind: "scalar",
      colormapName: "turbo",
    });
  });

  it("changes band request keys when source-affecting filters change", () => {
    const base = makeState({
      datasetId: "nisar-gcov",
      renderLabel: "Custom RGB Composite",
      datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
    });
    const orbitDirection = makeState({
      datasetId: "nisar-gcov",
      renderLabel: "Custom RGB Composite",
      datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
      extraParams: {
        attribute: "string,ASCENDING_DESCENDING,ASCENDING",
      },
    });
    const laterWindow = makeState({
      datasetId: "nisar-gcov",
      renderLabel: "Custom RGB Composite",
      datetime: "2026-02-01T00:00:00Z/2026-04-01T23:59:59Z",
    });

    expect(deriveActiveSources(base).map((item) => item.sourceKey)).not.toEqual(
      deriveActiveSources(orbitDirection).map((item) => item.sourceKey),
    );
    expect(
      deriveActiveSources(base).map((item) => item.rawBandRequests.map((request) => request.bandRequestKey)),
    ).not.toEqual(
      deriveActiveSources(orbitDirection).map((item) => item.rawBandRequests.map((request) => request.bandRequestKey)),
    );
    expect(
      deriveActiveSources(base).map((item) => item.rawBandRequests.map((request) => request.bandRequestKey)),
    ).not.toEqual(
      deriveActiveSources(laterWindow).map((item) => item.rawBandRequests.map((request) => request.bandRequestKey)),
    );
  });

  it("uses the smallest active min zoom across derived sub-layers", () => {
    const state = makeState({
      datasetId: "nisar-gcov",
      renderLabel: "Balanced Dual-Pol RGB",
      datetime: "2026-01-01T00:00:00Z/2026-04-01T23:59:59Z",
    });

    const derived = deriveRasterState(state);

    expect(derived.layers).toHaveLength(2);
    expect(derived.layers.map((item) => item.minzoom)).toEqual([6, 10]);
    expect(derived.effectiveMinZoom).toBe(6);
  });
});
