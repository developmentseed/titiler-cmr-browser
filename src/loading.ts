import type { Map } from "maplibre-gl";

/**
 * Sets visibility on all symbol layers in the current style (basemap labels).
 */
function setBasemapLabelsVisible(map: Map, visible: boolean): void {
  const visibility = visible ? "visible" : "none";
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type === "symbol") {
      map.setLayoutProperty(layer.id, "visibility", visibility);
    }
  }
}

/**
 * Shows a loading indicator while map tiles are being fetched, but only when
 * the map is at or above the active layer's minimum zoom (below that, no data
 * tiles are requested). `getMinZoom` is called on each event so it always
 * reflects the currently selected collection.
 *
 * Also toggles basemap labels: shown while tiles are loading (so the map
 * isn't a blank dark canvas), hidden once tiles finish rendering.
 */
export function initLoading(map: Map, getMinZoom: () => number): void {
  const el = document.getElementById("loading")!;

  map.on("dataloading", () => {
    if (map.getZoom() >= getMinZoom()) {
      el.classList.add("visible");
      setBasemapLabelsVisible(map, true);
    }
  });

  map.on("idle", () => {
    el.classList.remove("visible");
    setBasemapLabelsVisible(map, map.getZoom() < getMinZoom());
  });
}
