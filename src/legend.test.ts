import { afterEach, describe, expect, it, vi } from "vitest";
import { updateLegend } from "./legend";

describe("legend", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders a client-derived colormap legend", async () => {
    document.body.innerHTML = '<div id="legend"></div>';
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: () => {},
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          "0": [0, 0, 0, 255],
          "255": [255, 255, 255, 255],
        }),
      }),
    );

    updateLegend({
      kind: "colormap",
      colormapName: "viridis",
      range: [-2, 29],
      units: "°C",
    });

    await vi.waitFor(() => {
      const legend = document.getElementById("legend");
      expect(legend?.classList.contains("visible")).toBe(true);
      expect(legend?.textContent).toContain("29");
      expect(legend?.textContent).toContain("-2");
      expect(legend?.textContent).toContain("°C");
      expect(legend?.querySelector("canvas")).not.toBeNull();
    });
  });

  it("hides the legend when the active style has no scalar colormap", () => {
    document.body.innerHTML = '<div id="legend" class="visible">stale</div>';

    updateLegend({ kind: "none" });

    const legend = document.getElementById("legend");
    expect(legend?.classList.contains("visible")).toBe(false);
    expect(legend?.innerHTML).toBe("");
  });
});
