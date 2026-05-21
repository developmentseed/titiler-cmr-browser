import { afterEach, describe, expect, it, vi } from "vitest";
import { __test__, exportMapImage } from "./export";

describe("export", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("builds a stable export filename", () => {
    expect(
      __test__.buildExportFilename(
        "mur-sst",
        "MUR SST",
        "Sea Surface Temperature",
        "2026-05-19",
      ),
    ).toBe("titiler-cmr-mur-sst-mur-sst-sea-surface-temperature-2026-05-19.png");
  });

  it("captures the map canvas and triggers a download", () => {
    const drawImage = vi.fn();
    const measureText = vi.fn().mockReturnValue({ width: 80 });
    const fillRect = vi.fn();
    const fillText = vi.fn();
    const toDataURL = vi.fn().mockReturnValue("data:image/png;base64,abc");
    const click = vi.fn();

    const originalCreateElement = document.createElement.bind(document);

    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage,
            measureText,
            fillRect,
            fillText,
            fillStyle: "",
            font: "",
          }),
          toDataURL,
        } as unknown as HTMLCanvasElement;
      }

      if (tagName === "a") {
        return {
          download: "",
          href: "",
          click,
        } as unknown as HTMLAnchorElement;
      }

      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const mapCanvas = document.createElement("canvas");
    Object.defineProperty(mapCanvas, "width", { value: 512 });
    Object.defineProperty(mapCanvas, "height", { value: 256 });

    const map = {
      getCanvas: () => mapCanvas,
    };

    exportMapImage(
      map as never,
      '<a href="https://example.com">MUR SST</a>',
      "mur-sst",
      "mur",
      "Sea Surface Temperature",
      "2026-05-19",
    );

    expect(drawImage).toHaveBeenCalledWith(mapCanvas, 0, 0);
    expect(fillRect).toHaveBeenCalled();
    expect(fillText).toHaveBeenCalledWith("MUR SST", expect.any(Number), expect.any(Number));
    expect(toDataURL).toHaveBeenCalledWith("image/png");
    expect(click).toHaveBeenCalledOnce();
  });
});
