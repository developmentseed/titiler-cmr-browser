# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

Create a minimal, beautiful map application showcasing [titiler-cmr](https://developmentseed.org/titiler-cmr)'s data rendering capability, hosted on GitHub Pages. The map should cover as much of the browser window as possible, with a default globe view, and expose basic controls like start/end datetime filtering.

Key UX requirements:
- Per-layer minimum zoom enforcement with a visual indicator prompting users to zoom in
- Tile loading indicator (tile fetches can be slow)
- Globe view as default projection

## Tech Stack

- **Build tool:** Vite
- **Language:** TypeScript
- **Mapping:** MapLibre GL JS v5 (supports globe projection natively)
- **Deployment:** GitHub Pages (static site, `gh-pages` branch via `gh-pages` npm package)

## Development Commands

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production (runs tsc then vite build)
npm run build

# Preview production build locally
npm run preview

# Deploy to GitHub Pages (builds then pushes dist/ to gh-pages branch)
npm run deploy
```

## titiler-cmr API Integration

The backend API is documented at https://developmentseed.org/titiler-cmr. Key endpoints used by this app:

- **TileJSON:** `GET /{backend}/WebMercatorQuad/tilejson.json` — returns metadata including tile URL template; pass as a `raster-source` in MapLibre
- **Tiles:** `GET /{backend}/tiles/{z}/{x}/{y}` — the actual tile imagery (`rasterio` backend for GeoTIFF/COG, `xarray` for NetCDF/HDF5)

Common query parameters for tile requests: `collection_concept_id`, `datetime`, `assets`/`variables`, `assets_regex`, `rescale`, `colormap_name`, `expression`, `minzoom`, `maxzoom`.

The hosted titiler-cmr instance URL is stored in `src/config.ts` as `TITILER_ENDPOINT` (currently `https://staging.openveda.cloud/api/titiler-cmr`).

## Architecture

Single-page static site, no server-side code. Globe projection via MapLibre GL JS v5 (`map.setProjection({ type: 'globe' })` called on `load`). Base map style: CartoCDN dark-matter.

MapLibre parallel image request limits are bumped to 64 (`MAX_PARALLEL_IMAGE_REQUESTS` and `MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME`) because CMR tiles are slow and benefit from aggressive parallel fetching.

```
src/
  config.ts       # TITILER_ENDPOINT, type definitions, DATASETS array
  main.ts         # Map init, sky/globe setup, wires controls → layers → zoom-guard → loading
  controls.ts     # Dataset/Collection/Render selects + date picker + extra params; exports getState()
  layers.ts       # updateLayer(): removes old CMR sources/layers, builds TileJSON URL, adds new raster source(s)
  loading.ts      # Shows #loading spinner on map `dataloading`, hides on `idle`
  zoom-guard.ts   # Shows #zoom-guard message when zoom < collection.minzoom
  style.css       # Full-viewport map, absolute-positioned overlay panels
```

## Type System (`src/config.ts`)

### `DatasetConfig`
Top-level entry in `DATASETS`. Has `id`, `label`, and `collection` (a single `CollectionConfig` hides the collection selector; an array shows it).

### `CollectionConfig`
Describes one CMR collection. Key fields:
- `collectionConceptId` — CMR concept ID passed as `collection_concept_id`
- `backend` — `"rasterio"` (GeoTIFF/COG) or `"xarray"` (NetCDF/HDF5)
- `assetsRegex` — optional regex forwarded to titiler-cmr for asset filtering
- `minzoom` / `maxzoom`
- `attribution` — HTML string shown in MapLibre attribution control
- `date: DateConfig` — controls date picker UI and `datetime` param format
- `renders: RenderConfig[]`
- `queryParams?: QueryParamConfig[]` — optional extra controls surfaced in the "Advanced" panel

### `DateConfig`
Controls how the date UI is rendered and how `datetime` is serialized:
- `{ mode: "single"; default: string }` — one date input; datetime sent as a single-day range
- `{ mode: "range"; default: [string, string] }` — two date inputs (start / end)
- `{ mode: "month"; default: string }` — month/year picker; datetime sent as full calendar month range

### `RenderConfig`
One entry in `collection.renders`. Has `label`, optional `assets[]` (rasterio) or `variables[]` (xarray), `params` (arbitrary extra query params, values may be arrays for repeated params), and optional `subLayers`.

### `SubLayerSpec`
When `render.subLayers` is set, `updateLayer()` creates one map layer per entry instead of a single layer. Each sub-layer has its own `params` override (e.g. `group` for xarray) and `minzoom`/`maxzoom`. Used for NISAR frequencyA/B switching based on zoom level.

### `QueryParamConfig`
Union of four control types surfaced in the "Advanced" collapsible:
- `RangeQueryParam` — two number inputs rendered as `"min,max"`
- `SelectQueryParam` — dropdown; value sent as-is
- `TextQueryParam` — free-text input
- `AttributeQueryParam` — CMR additional-attribute filter; serialized as `attributeType,attributeName,value` under the `attribute` key. Supports a null value to omit the filter.

## Layer Update Flow

Controls emit a `ControlState` on any change → `updateLayer()`:
1. Scans and removes all `cmr-0`…`cmr-7` layers/sources (fixed ID space, tolerates partial failures)
2. Builds `URLSearchParams` from collection + render + datetime + extraParams
3. If `render.subLayers` exists: adds one `raster` source+layer per sub-layer with per-sub-layer `minzoom`/`maxzoom`
4. Otherwise: adds a single `cmr-0` raster source+layer

MapLibre fetches TileJSON natively when `type: 'raster'` with a `url` field is used.

## Adding a New Dataset

Add a new `DatasetConfig` entry to the `DATASETS` array in `src/config.ts`. No other code changes are needed. Key decisions per collection:
- `backend`: use `rasterio` for GeoTIFF/COG, `xarray` for NetCDF/HDF5
- `date.mode`: `"month"` works well for high-revisit optical (HLS); `"range"` for SAR/sparse; `"single"` for daily products (SST)
- `queryParams`: add `cloud_cover` range for optical sensors, `attribute` filters for orbit direction etc.
- `subLayers`: use when different zoom levels should hit different xarray groups (e.g. NISAR frequencyA vs frequencyB)
- `assetsRegex`: use for rasterio collections where asset names follow a pattern (e.g. `"B[0-9][0-9]"` for HLS)

## Existing Datasets

- **HLS** (`C2021957657-LPCLOUD` / `C2021957295-LPCLOUD`) — Harmonized Landsat/Sentinel-2, rasterio, minzoom 5, True Color + False Color renders, cloud cover filter
- **NISAR Beta GCOV** (`C3622214170-ASF`) — xarray, minzoom 6, HHHH/HVHV RGB render with frequencyA/B sub-layers, orbit direction attribute filter
- **MUR SST** (`C1996881146-POCLOUD`) — xarray, minzoom 0, SST + sea ice fraction renders
