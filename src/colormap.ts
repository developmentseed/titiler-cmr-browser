import { TITILER_ENDPOINT } from "./config";

export type ColormapData = Record<string, [number, number, number, number]>;

const colormapCache = new Map<string, Promise<ColormapData>>();
const lutCache = new Map<string, Promise<Uint8ClampedArray>>();

export async function fetchColormap(
  name: string,
  endpoint = TITILER_ENDPOINT,
): Promise<ColormapData> {
  const cacheKey = `${endpoint}:${name}`;
  let pending = colormapCache.get(cacheKey);
  if (!pending) {
    pending = fetch(`${endpoint}/colorMaps/${name}?f=json`).then(async (response) => {
      if (response.ok === false) {
        throw new Error(`Failed to load colormap ${name}: ${response.status}`);
      }
      return (await response.json()) as ColormapData;
    });
    colormapCache.set(cacheKey, pending);
  }
  return pending;
}

export function createColormapLut(data: ColormapData): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let index = 0; index < 256; index += 1) {
    const [r, g, b, a] = data[String(index)] ?? [0, 0, 0, 255];
    const offset = index * 4;
    lut[offset] = r;
    lut[offset + 1] = g;
    lut[offset + 2] = b;
    lut[offset + 3] = a;
  }
  return lut;
}

export async function getColormapLut(name: string): Promise<Uint8ClampedArray> {
  let pending = lutCache.get(name);
  if (!pending) {
    pending = fetchColormap(name).then((data) => createColormapLut(data));
    lutCache.set(name, pending);
  }
  return pending;
}

export function sampleColormap(
  lut: Uint8ClampedArray,
  normalized: number,
): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, normalized));
  const index = Math.round(clamped * 255);
  const offset = index * 4;
  return [lut[offset], lut[offset + 1], lut[offset + 2], lut[offset + 3]];
}
