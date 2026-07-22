# titiler-cmr-browser

A minimal map application showcasing [titiler-cmr](https://developmentseed.org/titiler-cmr)'s data rendering capability, hosted on GitHub Pages.

## Features

- Globe view when the raster layer is hidden; Mercator fallback while deck raster layers are active
- Tile loading indicator (tile fetches from titiler-cmr can be slow)
- Per-layer minimum zoom enforcement with a visual prompt to zoom in
- Dataset / collection / render switching with live tile updates
- Native single-day, week, month, and custom date-range controls
- Advanced query parameter controls (cloud cover, orbit direction, etc.)
- Mobile-friendly collapsible controls panel

## Datasets

| Dataset | Collections | Backend |
|---|---|---|
| HLS (Harmonized Landsat Sentinel-2) | HLSL30 (Landsat 8/9), HLSS30 (Sentinel-2) | rasterio |
| NISAR Provisional GCOV | NISAR L2 GCOV with balanced, vegetation, urban, water-emphasis, and custom RGB SAR renders | xarray |
| MUR Sea Surface Temperature | MUR SST | xarray |

## Development

```bash
npm install
npm run dev       # start dev server
npm test          # run Vitest unit tests
npm run build     # TypeScript check + Vite production build
npm run preview   # preview production build locally
```

## Architecture

Single-page static site — no server-side code.

```
src/
  config.ts       # TITILER_ENDPOINT, type definitions, DATASETS array, typed fetch/style render metadata
  controls.ts     # Dataset/collection/render selects, date controls, extra params
  main.ts         # Map init; owns the MapLibre shell and the interleaved deck.gl overlay
  state.ts        # Derives sourceKey, styleKey, and per-band request specs
  band-cache.ts   # Memory-first raw band cache keyed by bandRequestKey + z/x/y
  titiler-cmr.ts  # Loads the WebMercatorQuad descriptor, fetches missing raw bands, and assembles tiles
  tile-data.ts    # Decodes .npy payloads and normalizes upload-ready tile metadata
  render-plan.ts  # Compiles typed scalar/RGB styles into render plans
  deck-layers.ts  # Builds RasterTileLayer instances keyed by sourceKey/styleKey
  loading.ts      # Tracks deck-managed tile requests for the loading spinner
  legend.ts       # Renders the client-side scalar colormap legend
  zoom-guard.ts   # Shows message when zoom < effective active min zoom
  style.css       # Full-viewport map, absolute-positioned overlay panels
```

Raster rendering now flows through deck.gl `RasterTileLayer` instances hosted inside MapLibre via `MapboxOverlay`. The browser fetches raw `.npy` tiles from `titiler-cmr`, preserves numeric values locally, and applies style-only changes client-side.

Because `@developmentseed/deck.gl-raster` does not yet implement Globe-view bounding volumes, the app falls back to Mercator whenever a raster deck layer is visible.

The titiler-cmr endpoint is configured in `src/config.ts` as `TITILER_ENDPOINT`. Swap this value to point at a different environment.

GitHub Pages deploys from release artifacts. Release Please opens the release PR on pushes to `main`; publishing that release triggers the Pages workflow.

## Adding a Dataset

Add a new `DatasetConfig` entry to the `DATASETS` array in `src/config.ts`. No other code changes are needed.

Each `CollectionConfig` requires:

| Field | Description |
|---|---|
| `collectionConceptId` | NASA CMR collection concept ID |
| `backend` | `rasterio` (GeoTIFF/COG) or `xarray` (NetCDF/HDF5) |
| `minzoom` / `maxzoom` | Zoom range for tile requests |
| `date` | Date UI mode and optional defaults, e.g. `{ mode: "single", default: "YYYY-MM-DD" }` or `{ mode: "range", default: ["YYYY-MM-DD", "YYYY-MM-DD"] }` |
| `renders` | Array of `RenderConfig` objects (label, assets/variables, query params) |
| `queryParams` | Optional extra controls: `range`, `select`, `text`, or `attribute` |

The NISAR collection uses render presets for a few common dual-pol interpretation modes plus a `Custom RGB Composite` render that exposes RGB channel selectors mapping `HHHH`, `HVHV`, and `HHHH:HVHV` into the red, green, and blue channels. Each selector choice carries its own suggested rescale range so channel stretches follow the chosen variables.

A dataset with a single collection hides the collection selector in the UI. A dataset with multiple collections shows it.

## Layer Update Flow

1. Any control change updates `ControlState`.
2. `src/state.ts` derives source-affecting fetch inputs and style-affecting render inputs separately.
3. `src/deck-layers.ts` builds `RasterTileLayer` instances keyed by `sourceKey`, with rerender invalidation driven by `styleKey`.
4. `src/band-cache.ts` reuses raw band tiles by `bandRequestKey + z/x/y`, so overlapping render changes only fetch missing bands.
5. `src/titiler-cmr.ts` fetches raw `.npy` tiles from `/{backend}/tiles/WebMercatorQuad/{z}/{x}/{y}.npy` using only source-affecting params, then assembles the requested multi-band tile locally.
6. `src/render-plan.ts` and the GPU render path apply client-side expressions, rescale, RGB composition, and colormaps without asking the server to restyle the tile.
