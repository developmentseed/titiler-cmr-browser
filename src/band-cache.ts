import type { NdArrayTile } from "./tile-data";

export type CachedBandTile = {
  ndarray: NdArrayTile | null;
};

export type BandTileCache = {
  get: (key: string) => CachedBandTile | undefined;
  set: (key: string, value: CachedBandTile) => void;
  getOrLoad: (key: string, loader: () => Promise<CachedBandTile>) => Promise<CachedBandTile>;
  clear: () => void;
};

/**
 * Memory-only raw band cache keyed by bandRequestKey + z/x/y.
 * Failed loads are removed so later requests can retry.
 */
export function createBandTileCache(): BandTileCache {
  const settled = new Map<string, CachedBandTile>();
  const inFlight = new Map<string, Promise<CachedBandTile>>();

  return {
    get(key) {
      return settled.get(key);
    },
    set(key, value) {
      settled.set(key, value);
    },
    getOrLoad(key, loader) {
      const cached = settled.get(key);
      if (cached) {
        return Promise.resolve(cached);
      }

      const pending = inFlight.get(key);
      if (pending) {
        return pending;
      }

      const loadPromise = loader()
        .then((value) => {
          settled.set(key, value);
          inFlight.delete(key);
          return value;
        })
        .catch((error: unknown) => {
          inFlight.delete(key);
          throw error;
        });

      inFlight.set(key, loadPromise);
      return loadPromise;
    },
    clear() {
      settled.clear();
      inFlight.clear();
    },
  };
}
