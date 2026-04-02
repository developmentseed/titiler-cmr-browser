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

initAbout();
initCollectionDetails();

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [0, 20],
  zoom: 2,
});

map.addControl(new maplibregl.NavigationControl(), "bottom-right");

let mapReady = false;

const { getState } = initControls((state) => {
  if (mapReady) {
    updateLayer(map, state);
    updateLegend(state);
  }
});

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
  updateLayer(map, getState());
  updateLegend(getState());
});
