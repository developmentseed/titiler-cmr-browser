import type { Map } from "maplibre-gl";
import { TITILER_ENDPOINT } from "./config";
import type { ActiveSourceDefinition, ParamValue } from "./state";

const MAX_SERVER_LAYERS = 8;

function appendParam(search: URLSearchParams, key: string, value: ParamValue): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      search.append(key, item);
    }
    return;
  }

  search.set(key, value);
}

export function buildTileJsonUrl(
  source: ActiveSourceDefinition,
  serverParams: Record<string, string | string[]>,
  endpoint = TITILER_ENDPOINT,
): string {
  const search = new URLSearchParams();
  search.set("collection_concept_id", source.collectionConceptId);
  search.set("datetime", source.datetime);

  for (const asset of source.assets ?? []) {
    search.append("assets", asset);
  }
  for (const variable of source.variables ?? []) {
    search.append("variables", variable);
  }
  for (const [key, value] of Object.entries(source.params)) {
    appendParam(search, key, value);
  }
  for (const [key, value] of Object.entries(serverParams)) {
    appendParam(search, key, value);
  }

  search.set("minzoom", String(source.minzoom));
  if (source.maxzoom !== undefined) {
    search.set("maxzoom", String(source.maxzoom));
  }

  return `${endpoint}/${source.backend}/WebMercatorQuad/tilejson.json?${search.toString()}`;
}

export function clearServerLayers(map: Map): void {
  for (let index = 0; index < MAX_SERVER_LAYERS; index += 1) {
    const id = `cmr-server-${index}`;
    try {
      if (map.getLayer(id)) {
        map.removeLayer(id);
      }
    } catch {
      // noop
    }
    try {
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    } catch {
      // noop
    }
  }
}

export function setServerLayersVisible(map: Map, visible: boolean): void {
  const value = visible ? "visible" : "none";
  for (let index = 0; index < MAX_SERVER_LAYERS; index += 1) {
    const id = `cmr-server-${index}`;
    try {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", value);
      }
    } catch {
      // noop
    }
  }
}

export function updateServerLayers(
  map: Map,
  sources: ActiveSourceDefinition[],
  serverParams: Record<string, string | string[]>,
): void {
  clearServerLayers(map);

  sources.forEach((source, index) => {
    const id = `cmr-server-${index}`;
    map.addSource(id, {
      type: "raster",
      url: buildTileJsonUrl(source, serverParams),
      tileSize: 256,
      ...(source.attribution ? { attribution: source.attribution } : {}),
    });
    map.addLayer({
      id,
      type: "raster",
      source: id,
      minzoom: source.minzoom,
      ...(source.maxzoom !== undefined ? { maxzoom: source.maxzoom } : {}),
    });
  });
}
