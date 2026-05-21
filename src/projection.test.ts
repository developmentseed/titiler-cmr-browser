import { describe, expect, it } from "vitest";
import { getRasterProjection } from "./projection";

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
