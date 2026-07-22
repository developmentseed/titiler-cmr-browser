# Changelog

## [0.2.0](https://github.com/developmentseed/titiler-cmr-browser/compare/v0.1.1...v0.2.0) (2026-07-21)

### Features

- fetch numpy tile arrays from titiler-cmr and render with deck.gl-raster
- move raster styling into the browser with client-side render plans and legends

### Bug Fixes

- move raster styling to the GPU
- rescale MICASA arrays server-side
- fix globe/Mercator projection switching while deck raster layers are active

## [0.1.1](https://github.com/developmentseed/titiler-cmr-browser/compare/v0.1.0...v0.1.1) (2026-07-21)

### Bug Fixes

- update NISAR to use the provisional collection instead of the beta collection

## 0.1.0 (2026-05-20)

### Features

- build the initial titiler-cmr browser map application
- add dataset, collection, render, date, and advanced query controls
- add HLS, NISAR, and MUR SST dataset presets
- encode app state in query parameters
- add image export and style improvements
- add render selections to the NISAR collection

### Bug Fixes

- set the GitHub Pages base path
- allow layer replacement while tiles are still loading
