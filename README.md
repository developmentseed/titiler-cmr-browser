# titiler-cmr Showcase

A minimal map application showcasing [titiler-cmr](https://developmentseed.org/titiler-cmr)'s data rendering capability, hosted on GitHub Pages.

## Features

- Globe projection by default (MapLibre GL JS v5)
- Tile loading indicator (tile fetches from titiler-cmr can be slow)
- Per-layer minimum zoom enforcement with a visual prompt to zoom in
- Dataset / collection / render switching with live tile updates
- Date and date-range pickers
- Advanced query parameter controls (cloud cover, orbit direction, etc.)
- Mobile-friendly collapsible controls panel

## Datasets

| Dataset | Collections | Backend |
|---|---|---|
| HLS (Harmonized Landsat Sentinel-2) | HLSL30 (Landsat 8/9), HLSS30 (Sentinel-2) | rasterio |
| NISAR Beta GCOV | NISAR L2 GCOV | xarray |
| MUR Sea Surface Temperature | MUR SST | xarray |

## Development

```bash
npm install
npm run dev       # start dev server
npm run build     # TypeScript check + Vite production build
npm run preview   # preview production build locally
npm run deploy    # build and push dist/ to gh-pages branch
```

## Architecture

Single-page static site — no server-side code.

```
src/
  config.ts       # TITILER_ENDPOINT, type definitions, DATASETS array
  main.ts         # Map init; wires controls → layers → zoom-guard → loading
  controls.ts     # Dataset/collection/render selects, date picker, extra params
  layers.ts       # updateLayer(): removes old source/layer, builds TileJSON URL, adds raster source
  loading.ts      # Shows spinner on map dataloading, hides on idle
  zoom-guard.ts   # Shows message when zoom < collection.minzoom
  style.css       # Full-viewport map, absolute-positioned overlay panels
```

The titiler-cmr endpoint is configured in `src/config.ts` as `TITILER_ENDPOINT`. Swap this value to point at a different environment.

## Adding a Dataset

Add a new `DatasetConfig` entry to the `DATASETS` array in `src/config.ts`. No other code changes are needed.

Each `CollectionConfig` requires:

| Field | Description |
|---|---|
| `collectionConceptId` | NASA CMR collection concept ID |
| `backend` | `rasterio` (GeoTIFF/COG) or `xarray` (NetCDF/HDF5) |
| `minzoom` / `maxzoom` | Zoom range for tile requests |
| `date` | `{ mode: "single", default: "YYYY-MM-DD" }` or `{ mode: "range", default: ["YYYY-MM-DD", "YYYY-MM-DD"] }` |
| `renders` | Array of `RenderConfig` objects (label, assets/variables, query params) |
| `queryParams` | Optional extra controls: `range`, `select`, `text`, or `attribute` |

A dataset with a single collection hides the collection selector in the UI. A dataset with multiple collections shows it.

## Layer Update Flow

1. Any control change calls `updateLayer(map, state)`.
2. All previous CMR sources/layers (`cmr-0` … `cmr-7`) are removed.
3. A TileJSON URL is built from the current state and added as a MapLibre `raster` source. MapLibre fetches the TileJSON natively and renders the tiles.
4. Renders that define `subLayers` produce one map layer per sub-layer (used by NISAR to switch between frequency-A and frequency-B grids based on zoom level).
