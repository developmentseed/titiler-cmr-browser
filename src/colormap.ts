import { TITILER_ENDPOINT } from "./config";

export type ColormapData = Record<string, [number, number, number, number]>;

const colormapCache = new Map<string, Promise<ColormapData>>();

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
