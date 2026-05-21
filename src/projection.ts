export type RasterProjection = "globe" | "mercator";

export type ZoomConstrainedLayer = {
  minzoom: number;
  maxzoom?: number;
};

export type ProjectionTarget = {
  getZoom: () => number;
  getProjection: () => { type?: unknown } | null | undefined;
  setProjection: (projection: { type: RasterProjection }) => void;
};

function isRenderableAtZoom(zoom: number, layer: ZoomConstrainedLayer): boolean {
  return zoom >= layer.minzoom && (layer.maxzoom === undefined || zoom < layer.maxzoom);
}

/**
 * deck.gl-raster does not currently support Globe view tile bounding volumes,
 * so only zoom-renderable raster deck layers should force Mercator.
 */
export function getRasterProjection(
  cmrLayerVisible: boolean,
  zoom: number,
  activeDeckLayers: ZoomConstrainedLayer[],
): RasterProjection {
  return cmrLayerVisible && activeDeckLayers.some((layer) => isRenderableAtZoom(zoom, layer))
    ? "mercator"
    : "globe";
}

export function syncRasterProjection(
  map: ProjectionTarget,
  cmrLayerVisible: boolean,
  activeDeckLayers: ZoomConstrainedLayer[],
  onProjectionChange?: (type: RasterProjection) => void,
): RasterProjection {
  const type = getRasterProjection(cmrLayerVisible, map.getZoom(), activeDeckLayers);
  if (map.getProjection()?.type !== type) {
    map.setProjection({ type });
    onProjectionChange?.(type);
  }
  return type;
}
