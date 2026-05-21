import type { Map } from "maplibre-gl";

/**
 * Shows a zoom-in prompt when the map zoom is below the active layer's
 * minimum zoom. `getMinZoom` is called on each zoom change so it always
 * reflects the currently selected collection.
 */
export function initZoomGuard(
  map: Map,
  getMinZoom: () => number
): () => void {
  const el = document.getElementById("zoom-guard")!;

  function update(): void {
    el.classList.toggle("visible", map.getZoom() < getMinZoom());
  }

  map.on("zoom", update);
  map.on("moveend", update);
  map.once("load", update);

  return update;
}
