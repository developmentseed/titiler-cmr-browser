import type { Layer } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// titiler-cmr tiles are slow to generate, so fire all requests immediately
// rather than drip-feeding them across animation frames.
maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS = 64;
maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME = 64;
import "./style.css";
import { initControls } from "./controls";
import { updateLegend } from "./legend";
import { createLoadingTracker, initLoading } from "./loading";
import { initZoomGuard } from "./zoom-guard";
import { initAbout } from "./about";
import { initCollectionDetails } from "./collection-details";
import { decodeState, encodeState, getRawDateFromDom } from "./url-state";
import { exportMapImage } from "./export";
import { deriveRasterState } from "./state";
import { createDeckLayers } from "./deck-layers";
import { syncRasterProjection, type ZoomConstrainedLayer } from "./projection";
import { loadWebMercatorQuadDescriptor, type TileMatrixSetDescriptor } from "./titiler-cmr";

initAbout();
initCollectionDetails();

// Wire share button (pre-existing in HTML)
const shareBtn = document.getElementById("share-btn") as HTMLButtonElement;
shareBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(window.location.href).then(() => {
    shareBtn.title = "Copied!";
    shareBtn.style.color = "#64a0ff";
    setTimeout(() => {
      shareBtn.title = "Copy link";
      shareBtn.style.color = "";
    }, 2000);
  });
});

const initialUrlState = decodeState();

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [0, 20],
  zoom: 2,
  canvasContextAttributes: { preserveDrawingBuffer: true },
});

const deckOverlay = new MapboxOverlay({
  interleaved: true,
  layers: [] as Layer[],
});
map.addControl(deckOverlay);

const loadingTracker = createLoadingTracker();
let activeDeckLayers: Layer[] = [];
let activeDeckLayerZoomRanges: ZoomConstrainedLayer[] = [];

function syncProjection(): void {
  if (!mapReady) {
    return;
  }

  syncRasterProjection(map, cmrLayerVisible, activeDeckLayerZoomRanges, () => {
    // In interleaved mode deck only re-derives its MapView/GlobeView when
    // setProps() runs, so a runtime globe↔mercator switch must resync the
    // overlay immediately or raster layers stay stuck on the old view type.
    deckOverlay.setProps({ layers: cmrLayerVisible ? activeDeckLayers : [] });
  });
}

function setDeckLayers(layers: Layer[] = [], zoomRanges: ZoomConstrainedLayer[] = []): void {
  activeDeckLayers = layers;
  activeDeckLayerZoomRanges = zoomRanges;
  deckOverlay.setProps({ layers: cmrLayerVisible ? activeDeckLayers : [] });
  syncProjection();
}

map.addControl(new maplibregl.NavigationControl(), "bottom-right");
const geolocate = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  fitBoundsOptions: { maxZoom: 10 },
});
map.addControl(geolocate, "bottom-right");
geolocate.on("geolocate", () => {
  setTimeout(() => {
    map.removeControl(geolocate);
    map.addControl(geolocate, "bottom-right");
  }, 3000);
});

document.getElementById("export-btn")!.addEventListener("click", () => {
  const { collection, render } = getState();
  const { datasetId, activeDateMode } = getUrlMeta();
  const rawDate = getRawDateFromDom(activeDateMode);
  const dateStr = rawDate.s && rawDate.e
    ? `${rawDate.s}_${rawDate.e}`
    : (rawDate.dt ?? undefined);
  exportMapImage(map, collection.attribution, datasetId, collection.slug, render.label, dateStr);
});

let mapReady = false;
let updateZoomGuard: (() => void) | null = null;
let tilesetDescriptor: TileMatrixSetDescriptor | null = null;

/** Writes current app + map state to the URL hash. */
function updateUrl() {
  const state = getState();
  const { datasetId, renderIdx, activeDateMode } = getUrlMeta();
  const center = map.getCenter();
  const rawDate = getRawDateFromDom(activeDateMode);
  encodeState({
    d: datasetId,
    c: state.collection.collectionConceptId,
    r: renderIdx,
    ...rawDate,
    dm: state.collection.date.mode === "switchable" ? activeDateMode : undefined,
    lng: parseFloat(center.lng.toFixed(4)),
    lat: parseFloat(center.lat.toFixed(4)),
    z: parseFloat(map.getZoom().toFixed(2)),
    b: parseFloat(map.getBearing().toFixed(1)) || undefined,
    pt: parseFloat(map.getPitch().toFixed(1)) || undefined,
    p:
      Object.keys(state.extraParams).length > 0
        ? state.extraParams
        : undefined,
  });
}

// --- Map display toggles ---
let cmrLayerVisible = true;
let labelsVisible = false;
let labelLayerIds: string[] = [];

function getLegendSpec() {
  return deriveRasterState(getState()).layers[0]?.style.legend ?? { kind: "none" as const };
}

function refreshLayers(): void {
  if (!mapReady) {
    return;
  }

  const rasterState = deriveRasterState(getState());
  if (!tilesetDescriptor) {
    setDeckLayers([]);
    return;
  }

  setDeckLayers(
    createDeckLayers(rasterState, tilesetDescriptor, loadingTracker),
    rasterState.layers.map((layer) => ({
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
    })),
  );
}

function setLabelsVisible(visible: boolean): void {
  for (const id of labelLayerIds) {
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

const { getState, getUrlMeta } = initControls(
  () => {
    if (mapReady) {
      refreshLayers();
      updateLegend(getLegendSpec());
      updateUrl();
      updateZoomGuard?.();
    }
  },
  initialUrlState
    ? {
        datasetId: initialUrlState.d,
        collectionId: initialUrlState.c,
        renderIdx: initialUrlState.r,
        date: initialUrlState.dt,
        start: initialUrlState.s,
        end: initialUrlState.e,
        dateMode: initialUrlState.dm,
        extraParams: initialUrlState.p,
      }
    : undefined
);

// Build and wire the map display toggles, appended after initControls populates #controls
const controlsEl = document.getElementById("controls")!;
const mapSection = document.createElement("div");
mapSection.className = "controls-map";

const layerToggle = document.createElement("button");
layerToggle.className = "map-toggle active";
layerToggle.title = "Toggle data layer";
layerToggle.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Data`;

const labelToggle = document.createElement("button");
labelToggle.className = "map-toggle";
labelToggle.title = "Toggle map labels";
labelToggle.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg> Labels`;

mapSection.appendChild(layerToggle);
mapSection.appendChild(labelToggle);
controlsEl.appendChild(mapSection);

layerToggle.addEventListener("click", () => {
  cmrLayerVisible = !cmrLayerVisible;
  layerToggle.classList.toggle("active", cmrLayerVisible);
  setDeckLayers(activeDeckLayers, activeDeckLayerZoomRanges);
});

labelToggle.addEventListener("click", () => {
  labelsVisible = !labelsVisible;
  labelToggle.classList.toggle("active", labelsVisible);
  setLabelsVisible(labelsVisible);
});

map.on("load", () => {
  mapReady = true;
  syncProjection();
  map.setSky({
    "sky-color": "#0d1117",
    "horizon-color": "#1a2233",
    "fog-color": "#0d1117",
    "fog-ground-blend": 0.9,
    "horizon-fog-blend": 0.5,
    "sky-horizon-blend": 0.5,
    "atmosphere-blend": 0.3,
  });
  // Collect basemap symbol layers for label toggling; hide by default
  labelLayerIds = map.getStyle().layers
    .filter((l) => l.type === "symbol")
    .map((l) => l.id);
  setLabelsVisible(false);

  initLoading(map, () => deriveRasterState(getState()).effectiveMinZoom, loadingTracker);
  updateZoomGuard = initZoomGuard(map, () => deriveRasterState(getState()).effectiveMinZoom);

  if (initialUrlState?.lng !== undefined) {
    map.jumpTo({
      center: [initialUrlState.lng, initialUrlState.lat],
      zoom: initialUrlState.z,
      bearing: initialUrlState.b ?? 0,
      pitch: initialUrlState.pt ?? 0,
    });
  }

  setDeckLayers();
  refreshLayers();
  void loadWebMercatorQuadDescriptor().then((descriptor) => {
    tilesetDescriptor = descriptor;
    refreshLayers();
  });
  updateLegend(getLegendSpec());
  updateUrl();
});

map.on("zoom", syncProjection);

map.on("moveend", () => {
  if (mapReady) updateUrl();
});

map.on("rotateend", () => {
  if (mapReady) updateUrl();
});

map.on("pitchend", () => {
  if (mapReady) updateUrl();
});
