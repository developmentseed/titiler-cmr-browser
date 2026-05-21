import {
  RasterTileLayer,
  type GetTileDataOptions,
  type RasterTileLayerProps,
} from "@developmentseed/deck.gl-raster";
import type { Layer } from "@deck.gl/core";
import { createBandTileCache, type BandTileCache } from "./band-cache";
import { getColormapLut } from "./colormap";
import {
  destroyGpuTileResources,
  getColormapTexture,
  renderTileWithGpuModules,
} from "./gpu-render";
import { compileRenderPlan } from "./render-plan";
import {
  getTileData,
  type DecodedTileData,
  type MaybeDecodedTileData,
  type RequestTracker,
  type TileMatrixSetDescriptor,
} from "./titiler-cmr";
import type { DerivedLayerState, DerivedRasterState } from "./state";

const sharedBandCache = createBandTileCache();

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function getDeckLayerId(layer: DerivedLayerState, index: number): string {
  return `cmr-${index}-${hashString(`${layer.source.sourceKey}/${layer.style.styleKey}`)}`;
}

export function createDeckLayer(
  layer: DerivedLayerState,
  index: number,
  descriptor: TileMatrixSetDescriptor,
  tracker?: RequestTracker,
  bandCache: BandTileCache = sharedBandCache,
): Layer {
  const compiled = compileRenderPlan(layer.style);
  const cpuColormapLutPromise =
    compiled.kind === "scalar" ? getColormapLut(compiled.colormapName) : undefined;

  const props: RasterTileLayerProps<MaybeDecodedTileData> = {
    id: getDeckLayerId(layer, index),
    minZoom: layer.minzoom,
    ...(layer.maxzoom !== undefined ? { maxZoom: layer.maxzoom } : {}),
    tileSize: 256,
    maxRequests: 64,
    refinementStrategy: "best-available",
    tilesetDescriptor: descriptor,
    getTileData: async (tile, options: GetTileDataOptions) => {
      const data = await getTileData(tile, options, layer.source, tracker, bandCache);
      if (data && compiled.kind === "scalar") {
        const [colormapTexture, cpuColormapLut] = await Promise.all([
          getColormapTexture(options.device),
          cpuColormapLutPromise,
        ]);
        data.colormapTexture = colormapTexture;
        data.cpuColormapLut = cpuColormapLut;
      }
      return data;
    },
    renderTile: (data) => {
      if (!data) {
        return null;
      }
      try {
        return renderTileWithGpuModules(data, compiled);
      } catch {
        return { image: compiled.renderTile(data) };
      }
    },
    updateTriggers: {
      renderTile: [compiled.styleKey],
    },
    onTileUnload: (tile) => {
      if (tile.content) {
        destroyGpuTileResources(tile.content as DecodedTileData);
      }
    },
  };

  return new RasterTileLayer(props);
}

export function createDeckLayers(
  rasterState: DerivedRasterState,
  descriptor: TileMatrixSetDescriptor,
  tracker?: RequestTracker,
  bandCache: BandTileCache = sharedBandCache,
): Layer[] {
  return rasterState.layers.map((layer, index) =>
    createDeckLayer(layer, index, descriptor, tracker, bandCache),
  );
}
