export type RasterProjection = "globe" | "mercator";

/**
 * deck.gl-raster does not currently support Globe view tile bounding volumes,
 * so visible raster deck layers must render in Mercator.
 */
export function getRasterProjection(
  cmrLayerVisible: boolean,
  activeDeckLayerCount: number,
): RasterProjection {
  return cmrLayerVisible && activeDeckLayerCount > 0 ? "mercator" : "globe";
}
