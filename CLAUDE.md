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
- **Mapping:** MapLibre GL JS (supports globe projection natively)
- **Deployment:** GitHub Pages (static site, `gh-pages` branch)

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

- **TileJSON:** `GET /{backend}/tilejson.json` — returns metadata including tile URL template; pass as a `raster-source` in MapLibre
- **Tiles:** `GET /{backend}/tiles/{z}/{x}/{y}` — the actual tile imagery (`rasterio` backend for GeoTIFF/COG, `xarray` for NetCDF/HDF5)
- **Granule search:** `GET /bbox/{minx},{miny},{maxx},{maxy}/granules` — find available granules in a bounding box

Common query parameters for tile requests: `concept_id`, `datetime`, `assets`/`bands`, `rescale`, `colormap_name`.

The hosted titiler-cmr instance URL should be stored in a single config constant (e.g., `src/config.ts`) so it can be easily swapped between environments.

## Architecture

Single-page static site, no server-side code. Globe projection via MapLibre GL JS v5 (`map.setProjection({ type: 'globe' })` called on `load`).

```
src/
  config.ts       # TITILER_ENDPOINT, DatasetConfig/CollectionConfig/RenderConfig types, DATASETS array
  main.ts         # Map init, wires controls → layers → zoom-guard → loading
  controls.ts     # Dataset/Collection/Render selects + date picker; exports getState()
  layers.ts       # updateLayer(): removes old source/layer, builds TileJSON URL, adds new raster source
  loading.ts      # Shows #loading spinner on map `dataloading`, hides on `idle`
  zoom-guard.ts   # Shows #zoom-guard message when zoom < collection.minzoom
  style.css       # Full-viewport map, absolute-positioned overlay panels
```

### Adding a new dataset

Add a new `DatasetConfig` entry to the `DATASETS` array in `src/config.ts`. No other code changes are needed. Each collection needs: `conceptId`, `assetsRegex`, `backend` (`rasterio` | `xarray`), `minzoom`/`maxzoom`, `defaultDate`, and a `renders` array of `RenderConfig` objects.

### Layer update flow

Controls emit a `ControlState` on any change → `updateLayer()` removes the previous `cmr-layer`/`cmr-source` and adds a new raster source pointing at the TileJSON endpoint with all render params encoded in the URL. MapLibre fetches TileJSON natively when `type: 'raster'` with a `url` field is used.
