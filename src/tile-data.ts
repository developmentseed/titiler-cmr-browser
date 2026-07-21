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

function makeTileArray(dtype: DType, length: number): SupportedTileArray {
  switch (dtype) {
    case "u1":
      return new Uint8Array(length);
    case "i1":
      return new Int8Array(length);
    case "u2":
      return new Uint16Array(length);
    case "i2":
      return new Int16Array(length);
    case "u4":
      return new Uint32Array(length);
    case "i4":
      return new Int32Array(length);
    case "f4":
      return new Float32Array(length);
    case "f8":
      return new Float64Array(length);
    default:
      throw new Error(`Unsupported ndarray dtype for assembly: ${dtype}`);
  }
}

function copyBandValues(
  target: SupportedTileArray,
  targetOffset: number,
  tile: NdArrayTile,
  bandIndex: number,
): void {
  const pixelCount = tile.width * tile.height;

  if (tile.shape.length === 2) {
    if (bandIndex !== 0) {
      throw new Error(
        `Tile shape ${JSON.stringify(tile.shape)} does not expose band index ${bandIndex}.`,
      );
    }
    target.set(tile.data, targetOffset);
    return;
  }

  if (tile.shape.length === 3) {
    if (bandIndex < 0 || bandIndex >= tile.bandCount) {
      throw new Error(
        `Tile shape ${JSON.stringify(tile.shape)} does not expose band index ${bandIndex}.`,
      );
    }
    const bandOffset = bandIndex * pixelCount;
    target.set(tile.data.subarray(bandOffset, bandOffset + pixelCount), targetOffset);
    return;
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

  const pixelCount = width * height;
  const dtypes = new Set(tiles.map((tile) => tile.dtype));
  const dtype = dtypes.size === 1 ? first.dtype : "f4";
  const allHaveSharedAlpha = tiles.every((tile) => tile.bandCount === 2);
  const bandCount = tiles.length + (allHaveSharedAlpha ? 1 : 0);
  const data = makeTileArray(dtype, bandCount * pixelCount);

  tiles.forEach((tile, index) => {
    copyBandValues(data, index * pixelCount, tile, 0);
  });

  if (allHaveSharedAlpha) {
    const alphaOffset = tiles.length * pixelCount;
    copyBandValues(data, alphaOffset, tiles[0], 1);
    for (const tile of tiles.slice(1)) {
      const bandOffset = tile.shape.length === 3 ? pixelCount : 0;
      for (let index = 0; index < pixelCount; index++) {
        data[alphaOffset + index] = Math.min(
          Number(data[alphaOffset + index]),
          Number(tile.data[bandOffset + index]),
        );
      }
    }
  }

  return {
    data,
    dtype,
    shape: bandCount === 1 ? [height, width] : [bandCount, height, width],
    width,
    height,
    bandCount,
    byteLength: data.byteLength,
  };
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
