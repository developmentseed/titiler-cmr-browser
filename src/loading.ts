import type { Map } from "maplibre-gl";

/**
 * Shows a loading indicator while map tiles are being fetched, but only when
 * the map is at or above the active layer's minimum zoom (below that, no data
 * tiles are requested). `getMinZoom` is called on each event so it always
 * reflects the currently selected collection.
 */
export function initLoading(map: Map, getMinZoom: () => number): void {
  const el = document.getElementById("loading")!;

  map.on("dataloading", () => {
    if (map.getZoom() >= getMinZoom()) {
      el.classList.add("visible");
    }
  });

  map.on("idle", () => {
    el.classList.remove("visible");
  });
}
