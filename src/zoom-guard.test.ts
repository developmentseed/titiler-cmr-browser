import { afterEach, describe, expect, it } from "vitest";
import { initZoomGuard } from "./zoom-guard";

type Handler = () => void;

function createMapMock(initialZoom = 2) {
  let zoom = initialZoom;
  const handlers = new Map<string, Handler[]>();

  return {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    once(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    getZoom() {
      return zoom;
    },
    setZoom(nextZoom: number) {
      zoom = nextZoom;
    },
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) {
        handler();
      }
    },
  };
}

describe("zoom-guard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the zoom prompt below the effective min zoom and hides it above", () => {
    document.body.innerHTML = '<div id="zoom-guard"></div>';
    const map = createMapMock(4);

    const update = initZoomGuard(map as never, () => 5);
    update();

    expect(document.getElementById("zoom-guard")?.classList.contains("visible")).toBe(true);

    map.setZoom(6);
    map.emit("zoom");

    expect(document.getElementById("zoom-guard")?.classList.contains("visible")).toBe(false);
  });
});
