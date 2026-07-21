import { afterEach, describe, expect, it } from "vitest";
import { createLoadingTracker, initLoading } from "./loading";

type Handler = () => void;

function createMapMock(initialZoom = 2) {
  let zoom = initialZoom;
  const handlers = new Map<string, Handler[]>();

  return {
    on(event: string, handler: Handler) {
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

describe("loading", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the spinner while tracked requests are in flight at or above min zoom", () => {
    document.body.innerHTML = '<div id="loading"></div>';
    const map = createMapMock(6);
    const tracker = createLoadingTracker();

    initLoading(map as never, () => 5, tracker);
    tracker.start?.();

    expect(document.getElementById("loading")?.classList.contains("visible")).toBe(true);

    tracker.finish?.();

    expect(document.getElementById("loading")?.classList.contains("visible")).toBe(false);
  });

  it("suppresses the spinner below the effective min zoom even when requests are active", () => {
    document.body.innerHTML = '<div id="loading"></div>';
    const map = createMapMock(4);
    const tracker = createLoadingTracker();

    initLoading(map as never, () => 5, tracker);
    tracker.start?.();

    expect(document.getElementById("loading")?.classList.contains("visible")).toBe(false);

    map.setZoom(6);
    map.emit("zoom");

    expect(document.getElementById("loading")?.classList.contains("visible")).toBe(true);
  });
});
