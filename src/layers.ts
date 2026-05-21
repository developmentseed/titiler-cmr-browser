import type { Map as MapLibreMap } from "maplibre-gl";
import { TITILER_ENDPOINT } from "./config";
import type { CollectionConfig, RenderConfig } from "./config";
import type { ControlState } from "./controls";

/** Upper bound on the number of simultaneous CMR sub-layers any dataset uses. */
const MAX_CMR_LAYERS = 8;

/**
 * Removes all possible CMR layers/sources by scanning the fixed ID space
 * cmr-0…cmr-(MAX_CMR_LAYERS-1). Using a fixed scan (rather than tracking
 * activeIds) ensures cleanup succeeds even when a previous add partially
 * failed and left orphaned sources on the map.
 */
function removeCmrLayers(map: MapLibreMap): void {
  for (let i = 0; i < MAX_CMR_LAYERS; i++) {
    const id = `cmr-${i}`;
    try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ }
    try { if (map.getSource(id)) map.removeSource(id); } catch { /* ignore */ }
  }
}


/**
 * Sets the visibility of all currently-active CMR layers.
 * Safe to call when layers may not exist yet.
 */
export function setCmrLayersVisible(map: MapLibreMap, visible: boolean): void {
  const value = visible ? "visible" : "none";
  for (let i = 0; i < MAX_CMR_LAYERS; i++) {
    const id = `cmr-${i}`;
    try {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", value);
    } catch { /* ignore */ }
  }
}

const RGB_PARAM_KEYS = new Set(["rgb_r", "rgb_g", "rgb_b"]);

function getFirstParamValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getSelectedRgbOptions(
  render: RenderConfig,
  extraParams: Record<string, string | string[]>
) {
  if (!render.rgbExpression) return null;

  const options = new globalThis.Map(
    render.rgbExpression.options.map((option) => [option.value, option])
  );
  const [defaultR, defaultG, defaultB] = render.rgbExpression.defaults;
  const selected = [
    getFirstParamValue(extraParams.rgb_r) ?? defaultR,
    getFirstParamValue(extraParams.rgb_g) ?? defaultG,
    getFirstParamValue(extraParams.rgb_b) ?? defaultB,
  ];

  return selected.map((value, idx) => {
    const fallback = render.rgbExpression!.defaults[idx];
    return options.get(value) ?? options.get(fallback);
  });
}

function buildRgbExpression(
  render: RenderConfig,
  extraParams: Record<string, string | string[]>
): string | null {
  const channels = getSelectedRgbOptions(render, extraParams);
  if (!channels || channels.some((channel) => !channel)) return null;
  return channels.map((channel) => channel!.expression).join("; ");
}

function getEffectiveRescale(
  render: RenderConfig,
  extraParams: Record<string, string | string[]>
): [number, number][] {
  const channels = getSelectedRgbOptions(render, extraParams);
  if (!channels || channels.some((channel) => !channel?.rescale)) {
    return render.rescale ?? [];
  }
  return channels.map((channel) => channel!.rescale!);
}

/**
 * Builds the shared URLSearchParams for a TileJSON request.
 * Handles string | string[] param values and repeated `attribute` filters.
 */
function buildBaseParams(
  collection: CollectionConfig,
  render: RenderConfig,
  datetime: string,
  extraParams: Record<string, string | string[]>
): URLSearchParams {
  const p = new URLSearchParams();
  p.set("collection_concept_id", collection.collectionConceptId);
  p.set("datetime", datetime);

  for (const v of render.variables ?? []) p.append("variables", v);
  for (const a of render.assets ?? []) p.append("assets", a);
  if (collection.assetsRegex) p.set("assets_regex", collection.assetsRegex);

  p.set("maxzoom", String(collection.maxzoom));

  for (const [key, value] of Object.entries(render.params)) {
    if (Array.isArray(value)) {
      for (const v of value) p.append(key, v);
    } else {
      p.set(key, value);
    }
  }

  const rgbExpression = buildRgbExpression(render, extraParams);
  if (rgbExpression) p.set("expression", rgbExpression);

  for (const [lo, hi] of getEffectiveRescale(render, extraParams)) {
    p.append("rescale", `${lo},${hi}`);
  }

  for (const [key, value] of Object.entries(extraParams)) {
    if (RGB_PARAM_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const v of value) p.append(key, v);
    } else {
      p.set(key, value);
    }
  }

  return p;
}

/**
 * Adds a raster source + layer pair to the map and tracks their IDs.
 */
function addRasterLayer(
  map: MapLibreMap,
  id: string,
  tilejsonUrl: string,
  minzoom: number,
  maxzoom?: number,
  attribution?: string
): void {
  map.addSource(id, {
    type: "raster",
    url: tilejsonUrl,
    tileSize: 256,
    ...(attribution ? { attribution } : {}),
  });
  map.addLayer({
    id,
    type: "raster",
    source: id,
    minzoom,
    ...(maxzoom !== undefined ? { maxzoom } : {}),
  });
}

/**
 * Builds a TileJSON URL for the given control state and adds it to the map.
 * Replaces any previously added CMR layers.
 * When the render has `subLayers`, produces one map layer per sub-layer entry.
 */
export function updateLayer(map: MapLibreMap, state: ControlState): void {
  removeCmrLayers(map);

  const { collection, render, datetime, extraParams } = state;
  const base = `${TITILER_ENDPOINT}/${collection.backend}/WebMercatorQuad/tilejson.json`;

  if (render.subLayers && render.subLayers.length > 0) {
    render.subLayers.forEach((sub, i) => {
      const p = buildBaseParams(collection, render, datetime, extraParams);
      p.set("minzoom", String(sub.minzoom));
      if (sub.maxzoom !== undefined) p.set("maxzoom", String(sub.maxzoom));
      for (const [k, v] of Object.entries(sub.params)) p.set(k, v);
      addRasterLayer(map, `cmr-${i}`, `${base}?${p}`, sub.minzoom, sub.maxzoom, collection.attribution);
    });
  } else {
    const p = buildBaseParams(collection, render, datetime, extraParams);
    p.set("minzoom", String(collection.minzoom));
    addRasterLayer(map, "cmr-0", `${base}?${p}`, collection.minzoom, undefined, collection.attribution);
  }

}
