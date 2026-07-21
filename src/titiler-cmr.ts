import { TileMatrixSetAdaptor, type GetTileDataOptions } from "@developmentseed/deck.gl-raster";
import type { Device, Texture } from "@luma.gl/core";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { TITILER_ENDPOINT } from "./config";
import type { BandTileCache, CachedBandTile } from "./band-cache";
import type { ActiveSourceDefinition, RawBandRequestSpec } from "./state";
import {
  assembleBandTiles,
  createBandTextures,
  decodeNpyTile,
  type NdArrayTile,
} from "./tile-data";

const WEB_MERCATOR_WORLD_BOUNDS = 20037508.342789244;
const STYLE_PARAM_KEYS = new Set([
  "colormap_name",
  "color_formula",
]);

export type TileMatrixSetDescriptor = TileMatrixSetAdaptor;

export type TileIndexLike = {
  index: {
    x: number;
    y: number;
    z: number;
  };
};

export type RequestTracker = {
  start?: () => void;
  finish?: () => void;
};

export type GpuTileData = {
  device: Device;
  ndarray: NdArrayTile;
  width: number;
  height: number;
  byteLength: number;
  bandTextures: Texture[];
  colormapTexture?: Texture;
};

export type DecodedTileData = GpuTileData;
export type MaybeDecodedTileData = DecodedTileData | null;

function identity(x: number, y: number): [number, number] {
  return [x, y];
}

function projectFrom4326(lng: number, lat: number): [number, number] {
  const x = (lng * WEB_MERCATOR_WORLD_BOUNDS) / 180;
  const y =
    Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) /
    (Math.PI / 180);

  return [x, (y * WEB_MERCATOR_WORLD_BOUNDS) / 180];
}

function projectTo4326(x: number, y: number): [number, number] {
  const lng = (x / WEB_MERCATOR_WORLD_BOUNDS) * 180;
  const lat =
    (180 / Math.PI) *
    (2 * Math.atan(Math.exp((y / WEB_MERCATOR_WORLD_BOUNDS) * Math.PI)) -
      Math.PI / 2);

  return [lng, lat];
}

function withBoundingBox(tms: TileMatrixSet): TileMatrixSet {
  if (tms.boundingBox) {
    return tms;
  }

  return {
    ...tms,
    boundingBox: {
      lowerLeft: [-WEB_MERCATOR_WORLD_BOUNDS, -WEB_MERCATOR_WORLD_BOUNDS],
      upperRight: [WEB_MERCATOR_WORLD_BOUNDS, WEB_MERCATOR_WORLD_BOUNDS],
      crs: tms.crs,
      orderedAxes: ["X", "Y"],
    },
  };
}

function appendParams(params: URLSearchParams, values: Record<string, string | string[]>): void {
  for (const [key, value] of Object.entries(values)) {
    if (STYLE_PARAM_KEYS.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
      continue;
    }

    params.set(key, value);
  }
}

function buildBandParams(
  source: ActiveSourceDefinition,
  bandRequest: RawBandRequestSpec,
): Record<string, string | string[]> {
  // Raw band requests intentionally exclude display-only params such as
  // server-side colormaps, but may include source-affecting transforms such as
  // server-side expressions when a dataset needs them for GPU-safe values.
  return {
    collection_concept_id: source.collectionConceptId,
    datetime: source.datetime,
    ...(source.backend === "rasterio"
      ? { assets: [bandRequest.bandRef] }
      : { variables: [bandRequest.bandRef] }),
    ...source.params,
  };
}

function getBandTileCacheKey(tile: TileIndexLike, bandRequest: RawBandRequestSpec): string {
  // Cache reuse happens below the layer sourceKey: one entry per raw band tile.
  const { x, y, z } = tile.index;
  return `${bandRequest.bandRequestKey}/${z}/${x}/${y}`;
}

async function fetchBandTile(
  tile: TileIndexLike,
  options: GetTileDataOptions,
  source: ActiveSourceDefinition,
  bandRequest: RawBandRequestSpec,
  tracker?: RequestTracker,
): Promise<CachedBandTile> {
  const { x, y, z } = tile.index;
  const url = buildRawTileUrl(
    TITILER_ENDPOINT,
    source.backend,
    z,
    x,
    y,
    buildBandParams(source, bandRequest),
  );

  tracker?.start?.();

  try {
    const response = await fetch(url, { signal: options.signal });
    if (response.status === 204) {
      return { ndarray: null };
    }
    if (!response.ok) {
      throw new Error(`Failed to load ndarray tile: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      return { ndarray: null };
    }

    const ndarray = await decodeNpyTile(buffer);
    return { ndarray };
  } finally {
    tracker?.finish?.();
  }
}

function createDecodedTileData(
  ndarray: NdArrayTile,
  device?: GetTileDataOptions["device"],
): DecodedTileData {
  return {
    device: device as Device,
    ndarray,
    width: ndarray.width,
    height: ndarray.height,
    byteLength: ndarray.byteLength,
    bandTextures: createBandTextures(ndarray, device),
  };
}

export async function loadWebMercatorQuadDescriptor(
  endpoint = TITILER_ENDPOINT,
): Promise<TileMatrixSetDescriptor> {
  const response = await fetch(`${endpoint}/tileMatrixSets/WebMercatorQuad`);
  if (!response.ok) {
    throw new Error(`Failed to load WebMercatorQuad descriptor: ${response.status}`);
  }

  const raw = (await response.json()) as TileMatrixSet;
  const tms = withBoundingBox(raw);

  return new TileMatrixSetAdaptor(tms, {
    projectTo3857: identity,
    projectFrom3857: identity,
    projectTo4326,
    projectFrom4326,
  });
}

export function buildRawTileUrl(
  endpoint: string,
  backend: ActiveSourceDefinition["backend"],
  z: number,
  x: number,
  y: number,
  params: Record<string, string | string[]>,
): string {
  const search = new URLSearchParams();
  appendParams(search, params);
  return `${endpoint}/${backend}/tiles/WebMercatorQuad/${z}/${x}/${y}.npy?${search.toString()}`;
}

export async function getTileData(
  tile: TileIndexLike,
  options: GetTileDataOptions,
  source: ActiveSourceDefinition,
  tracker: RequestTracker | undefined,
  bandCache: BandTileCache,
): Promise<MaybeDecodedTileData> {
  const bandTiles = await Promise.all(
    source.rawBandRequests.map((bandRequest) =>
      bandCache.getOrLoad(getBandTileCacheKey(tile, bandRequest), () =>
        fetchBandTile(tile, options, source, bandRequest, tracker),
      ),
    ),
  );

  if (bandTiles.some((bandTile) => bandTile.ndarray === null)) {
    return null;
  }

  const ndarray = assembleBandTiles(bandTiles.map((bandTile) => bandTile.ndarray as NdArrayTile));
  return createDecodedTileData(ndarray, options.device);
}
