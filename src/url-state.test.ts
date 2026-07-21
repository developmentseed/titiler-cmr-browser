import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeState, encodeState } from "./url-state";

describe("url-state", () => {
  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("round-trips style-only selector params alongside source params", () => {
    const replaceState = vi.spyOn(history, "replaceState");

    encodeState({
      d: "nisar-gcov",
      c: "C3622214170-ASF",
      r: 4,
      s: "2026-01-01",
      e: "2026-04-01",
      lng: -72.1254,
      lat: 41.2231,
      z: 6.5,
      p: {
        attribute: "string,ASCENDING_DESCENDING,ASCENDING",
        rgb_r: "ratio",
        rgb_g: "hh",
        rgb_b: "hv",
      },
    });

    expect(replaceState).toHaveBeenCalledOnce();
    expect(window.location.hash).toContain("rgb_r=ratio");
    expect(window.location.hash).toContain("attribute=string%2CASCENDING_DESCENDING%2CASCENDING");

    expect(decodeState()).toEqual({
      d: "nisar-gcov",
      c: "C3622214170-ASF",
      r: 4,
      s: "2026-01-01",
      e: "2026-04-01",
      lng: -72.1254,
      lat: 41.2231,
      z: 6.5,
      b: undefined,
      pt: undefined,
      p: {
        attribute: "string,ASCENDING_DESCENDING,ASCENDING",
        rgb_r: "ratio",
        rgb_g: "hh",
        rgb_b: "hv",
      },
    });
  });

  it("preserves repeated params during decode", () => {
    window.location.hash =
      "#d=hls&c=C2021957295-LPCLOUD&r=0&s=2026-04-01&e=2026-04-30&lng=0&lat=20&z=2&attribute=a&attribute=b";

    expect(decodeState()).toEqual({
      d: "hls",
      c: "C2021957295-LPCLOUD",
      r: 0,
      s: "2026-04-01",
      e: "2026-04-30",
      lng: 0,
      lat: 20,
      z: 2,
      b: undefined,
      pt: undefined,
      p: {
        attribute: ["a", "b"],
      },
    });
  });

  it("rejects invalid numeric map state", () => {
    window.location.hash = "#d=hls&c=C2021957295-LPCLOUD&r=0&s=2026-04-01&e=2026-04-30&lng=oops&lat=20&z=2";

    expect(decodeState()).toBeNull();
  });
});
