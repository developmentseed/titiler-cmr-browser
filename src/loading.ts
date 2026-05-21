import type { Map } from "maplibre-gl";
import type { RequestTracker } from "./titiler-cmr";

export type LoadingTracker = RequestTracker & {
  getActiveRequestCount: () => number;
  subscribe: (listener: () => void) => () => void;
};

export function createLoadingTracker(): LoadingTracker {
  let activeRequestCount = 0;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    start: () => {
      activeRequestCount += 1;
      notify();
    },
    finish: () => {
      activeRequestCount = Math.max(0, activeRequestCount - 1);
      notify();
    },
    getActiveRequestCount: () => activeRequestCount,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Shows a loading indicator while deck-managed tile requests are in flight,
 * but only when the map is at or above the active layer's effective minimum
 * zoom.
 */
export function initLoading(
  map: Map,
  getMinZoom: () => number,
  tracker: LoadingTracker,
): () => void {
  const el = document.getElementById("loading")!;

  const update = () => {
    const visible =
      tracker.getActiveRequestCount() > 0 && map.getZoom() >= getMinZoom();
    el.classList.toggle("visible", visible);
  };

  const unsubscribe = tracker.subscribe(update);
  map.on("zoom", update);
  map.on("moveend", update);
  update();

  return () => {
    unsubscribe();
  };
}
