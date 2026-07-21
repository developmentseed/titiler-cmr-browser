import { describe, expect, it, vi } from "vitest";
import { getRasterProjection, syncRasterProjection, type ProjectionTarget } from "./projection";

describe("getRasterProjection", () => {
  it("uses Mercator only when a visible deck raster layer is renderable at the current zoom", () => {
    expect(getRasterProjection(true, 5, [{ minzoom: 6 }, { minzoom: 10 }])).toBe("globe");
    expect(getRasterProjection(true, 6, [{ minzoom: 6 }, { minzoom: 10 }])).toBe("mercator");
    expect(getRasterProjection(true, 10, [{ minzoom: 6, maxzoom: 10 }, { minzoom: 10 }])).toBe("mercator");
  });

  it("keeps Globe when deck raster layers are hidden or absent", () => {
    expect(getRasterProjection(true, 5, [])).toBe("globe");
    expect(getRasterProjection(false, 8, [{ minzoom: 6 }])).toBe("globe");
  });
});

describe("syncRasterProjection", () => {
  function createMap(args: {
    zoom: number;
    projection: "globe" | "mercator";
  }): ProjectionTarget {
    return {
      getZoom: () => args.zoom,
      getProjection: () => ({ type: args.projection }),
      setProjection: vi.fn((next) => {
        args.projection = next.type;
      }),
    };
  }

  it("switches projections and triggers a resync callback when zoom crosses a layer minzoom", () => {
    const map = createMap({ zoom: 5, projection: "globe" });
    const onProjectionChange = vi.fn();

    syncRasterProjection(map, true, [{ minzoom: 5 }], onProjectionChange);

    expect(map.setProjection).toHaveBeenCalledWith({ type: "mercator" });
    expect(onProjectionChange).toHaveBeenCalledWith("mercator");
  });

  it("does not resync when the projection is already correct", () => {
    const map = createMap({ zoom: 4, projection: "globe" });
    const onProjectionChange = vi.fn();

    syncRasterProjection(map, true, [{ minzoom: 5 }], onProjectionChange);

    expect(map.setProjection).not.toHaveBeenCalled();
    expect(onProjectionChange).not.toHaveBeenCalled();
  });
});
