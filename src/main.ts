import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// titiler-cmr tiles are slow to generate, so fire all requests immediately
// rather than drip-feeding them across animation frames.
maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS = 64;
maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME = 64;
import "./style.css";
import { initControls } from "./controls";
import { updateLayer } from "./layers";
import { updateLegend } from "./legend";
import { initLoading } from "./loading";
import { initZoomGuard } from "./zoom-guard";
import { initAbout } from "./about";
import { initCollectionDetails } from "./collection-details";
import { decodeState, encodeState, getRawDateFromDom } from "./url-state";
import { exportMapImage } from "./export";

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

map.addControl(new maplibregl.NavigationControl(), "bottom-right");
map.addControl(
  new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    fitBoundsOptions: { maxZoom: 10 },
  }),
  "bottom-right"
);

document.getElementById("export-btn")!.addEventListener("click", () => {
  const { collection, render } = getState();
  const { datasetId } = getUrlMeta();
  const rawDate = getRawDateFromDom(collection.date.mode);
  const dateStr = rawDate.s && rawDate.e
    ? `${rawDate.s}_${rawDate.e}`
    : (rawDate.dt ?? undefined);
  exportMapImage(map, collection.attribution, datasetId, collection.slug, render.label, dateStr);
});

let mapReady = false;

/** Writes current app + map state to the URL hash. */
function updateUrl() {
  const state = getState();
  const { datasetId, renderIdx } = getUrlMeta();
  const center = map.getCenter();
  const rawDate = getRawDateFromDom(state.collection.date.mode);
  encodeState({
    d: datasetId,
    c: state.collection.collectionConceptId,
    r: renderIdx,
    ...rawDate,
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

const { getState, getUrlMeta } = initControls(
  (state) => {
    if (mapReady) {
      updateLayer(map, state);
      updateLegend(state);
      updateUrl();
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
        extraParams: initialUrlState.p,
      }
    : undefined
);

map.on("load", () => {
  mapReady = true;
  map.setProjection({ type: "globe" });
  map.setSky({
    "sky-color": "#0d1117",
    "horizon-color": "#1a2233",
    "fog-color": "#0d1117",
    "fog-ground-blend": 0.9,
    "horizon-fog-blend": 0.5,
    "sky-horizon-blend": 0.5,
    "atmosphere-blend": 0.3,
  });
  initLoading(map, () => getState().collection.minzoom);
  initZoomGuard(map, () => getState().collection.minzoom);

  if (initialUrlState?.lng !== undefined) {
    map.jumpTo({
      center: [initialUrlState.lng, initialUrlState.lat],
      zoom: initialUrlState.z,
      bearing: initialUrlState.b ?? 0,
      pitch: initialUrlState.pt ?? 0,
    });
  }

  updateLayer(map, getState());
  updateLegend(getState());
  updateUrl();
});

map.on("moveend", () => {
  if (mapReady) updateUrl();
});

map.on("rotateend", () => {
  if (mapReady) updateUrl();
});

map.on("pitchend", () => {
  if (mapReady) updateUrl();
});
