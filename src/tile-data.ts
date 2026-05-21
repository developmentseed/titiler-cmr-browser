import type { Device, Texture } from "@luma.gl/core";
import Npyjs, { type DType } from "npyjs";

export type SupportedTileArray =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array;

export type NdArrayTile = {
  data: SupportedTileArray;
  dtype: DType;
  shape: number[];
  fortranOrder: boolean;
  width: number;
  height: number;
  bandCount: number;
  byteLength: number;
};

const npy = new Npyjs();

function isSupportedTileArray(value: ArrayBufferView): value is SupportedTileArray {
  return (
    value instanceof Uint8Array ||
    value instanceof Int8Array ||
    value instanceof Uint16Array ||
    value instanceof Int16Array ||
    value instanceof Uint32Array ||
    value instanceof Int32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array
  );
}

function makeTileArray(dtype: DType, values: number[]): SupportedTileArray {
  switch (dtype) {
    case "u1":
      return Uint8Array.from(values);
    case "i1":
      return Int8Array.from(values);
    case "u2":
      return Uint16Array.from(values);
    case "i2":
      return Int16Array.from(values);
    case "u4":
      return Uint32Array.from(values);
    case "i4":
      return Int32Array.from(values);
    case "f4":
      return Float32Array.from(values);
    case "f8":
      return Float64Array.from(values);
    default:
      throw new Error(`Unsupported ndarray dtype for assembly: ${dtype}`);
  }
}

function getBandValues(tile: NdArrayTile, bandIndex: number): number[] {
  const pixelCount = tile.width * tile.height;

  if (tile.shape.length === 2) {
    if (bandIndex !== 0) {
      throw new Error(
        `Tile shape ${JSON.stringify(tile.shape)} does not expose band index ${bandIndex}.`,
      );
    }
    return Array.from(tile.data, (value) => Number(value));
  }

  if (tile.shape.length === 3) {
    if (bandIndex < 0 || bandIndex >= tile.bandCount) {
      throw new Error(
        `Tile shape ${JSON.stringify(tile.shape)} does not expose band index ${bandIndex}.`,
      );
    }
    const bandOffset = bandIndex * pixelCount;
    return Array.from(
      tile.data.slice(bandOffset, bandOffset + pixelCount),
      (value) => Number(value),
    );
  }

  throw new Error(`Unsupported tile shape for band extraction: ${JSON.stringify(tile.shape)}.`);
}

export function getTileShape(shape: number[]): {
  width: number;
  height: number;
  bandCount: number;
} {
  if (shape.length === 2) {
    const [height, width] = shape;
    return { width, height, bandCount: 1 };
  }

  if (shape.length === 3) {
    const [bandCount, height, width] = shape;
    return { width, height, bandCount };
  }

  throw new Error(
    `Unsupported ndarray shape ${JSON.stringify(shape)}. Expected [height,width] or [band,height,width].`,
  );
}

export async function decodeNpyTile(
  source: ArrayBuffer | ArrayBufferView | Blob,
): Promise<NdArrayTile> {
  const parsed = await npy.load(source as ArrayBuffer);

  if (parsed.fortranOrder) {
    throw new Error("Fortran-ordered ndarray tiles are not supported.");
  }

  if (!isSupportedTileArray(parsed.data)) {
    throw new Error(`Unsupported ndarray typed array: ${parsed.data.constructor.name}`);
  }

  const { width, height, bandCount } = getTileShape(parsed.shape);

  return {
    data: parsed.data,
    dtype: parsed.dtype,
    shape: [...parsed.shape],
    fortranOrder: parsed.fortranOrder,
    width,
    height,
    bandCount,
    byteLength: parsed.data.byteLength,
  };
}

export function assembleBandTiles(tiles: NdArrayTile[]): NdArrayTile {
  if (tiles.length === 0) {
    throw new Error("Cannot assemble an empty band tile set.");
  }

  const [first] = tiles;
  const width = first.width;
  const height = first.height;

  for (const tile of tiles.slice(1)) {
    if (tile.width !== width || tile.height !== height) {
      throw new Error("Cannot assemble incompatible band tiles with different shapes.");
    }
    if (tile.bandCount > 2) {
      throw new Error(
        `Cannot assemble fetch-unit tile shape ${JSON.stringify(tile.shape)}. Expected at most data + alpha bands.`,
      );
    }
  }

  if (first.bandCount > 2) {
    throw new Error(
      `Cannot assemble fetch-unit tile shape ${JSON.stringify(first.shape)}. Expected at most data + alpha bands.`,
    );
  }

  const dtypes = new Set(tiles.map((tile) => tile.dtype));
  const dtype = dtypes.size === 1 ? first.dtype : "f4";
  const dataBands = tiles.map((tile) => getBandValues(tile, 0));
  const allHaveSharedAlpha = tiles.every((tile) => tile.bandCount === 2);
  const values = allHaveSharedAlpha
    ? [...dataBands.flat(), ...getBandValues(first, 1)]
    : dataBands.flat();
  const data = makeTileArray(dtype, values);
  const bandCount = dataBands.length + (allHaveSharedAlpha ? 1 : 0);

  return {
    data,
    dtype,
    shape: bandCount === 1 ? [height, width] : [bandCount, height, width],
    fortranOrder: false,
    width,
    height,
    bandCount,
    byteLength: data.byteLength,
  };
}

export function toGpuUploadArray(tile: NdArrayTile): Uint8Array | Float32Array {
  if (tile.data instanceof Float32Array || tile.data instanceof Uint8Array) {
    return tile.data;
  }

  if (
    tile.data instanceof Uint16Array ||
    tile.data instanceof Int16Array ||
    tile.data instanceof Float64Array ||
    tile.data instanceof Uint32Array ||
    tile.data instanceof Int32Array
  ) {
    return Float32Array.from(tile.data, (value) => Number(value));
  }

  return Uint8Array.from(tile.data, (value) => Number(value) & 0xff);
}

export function createBandTextures(
  ndarray: NdArrayTile,
  device?: Device,
): Texture[] {
  if (!device) {
    return [];
  }

  const pixelCount = ndarray.width * ndarray.height;
  const textures: Texture[] = [];

  for (let bandIndex = 0; bandIndex < ndarray.bandCount; bandIndex++) {
    const values = new Float32Array(pixelCount);
    const bandOffset = ndarray.shape.length === 3 ? bandIndex * pixelCount : 0;
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
      values[pixelIndex] = Number(ndarray.data[bandOffset + pixelIndex]);
    }

    textures.push(
      device.createTexture({
        width: ndarray.width,
        height: ndarray.height,
        format: "r32float",
        data: values,
        sampler: {
          minFilter: "nearest",
          magFilter: "nearest",
          mipmapFilter: "none",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
        },
      }),
    );
  }

  return textures;
}
