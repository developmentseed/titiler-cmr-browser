import { describe, expect, it } from "vitest";
import { getRasterProjection } from "./projection";

describe("getRasterProjection", () => {
  it("uses Mercator when deck raster layers are visible", () => {
    expect(getRasterProjection(true, 1)).toBe("mercator");
    expect(getRasterProjection(true, 3)).toBe("mercator");
  });

  it("keeps Globe when no raster deck layer is being drawn", () => {
    expect(getRasterProjection(true, 0)).toBe("globe");
    expect(getRasterProjection(false, 2)).toBe("globe");
  });
});
