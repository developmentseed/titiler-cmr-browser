/**
 * Compact serialized app state stored in the URL hash as URLSearchParams.
 * Example: #d=hls&c=C2021957295-LPCLOUD&r=0&dt=2024-01&lng=-95.1234&lat=38.2345&z=6&b=45&pt=30
 *
 * Reserved param names: d, c, r, dt, s, e, dm, lng, lat, z, b, pt.
 * All other params are treated as extra (titiler-cmr) query params.
 */
export interface SerializedState {
  d: string;    // datasetId
  c: string;    // collectionConceptId
  r: number;    // renderIdx
  dt?: string;  // date input value (single/month/week mode)
  s?: string;   // range start date
  e?: string;   // range end date
  dm?: string;  // active date sub-mode for switchable collections
  lng: number;  // map center longitude
  lat: number;  // map center latitude
  z: number;    // map zoom
  b?: number;   // map bearing (degrees, omitted when 0)
  pt?: number;  // map pitch (degrees, omitted when 0)
  p?: Record<string, string | string[]>; // extra params
}

const RESERVED = new Set(["d", "c", "r", "dt", "s", "e", "dm", "lng", "lat", "z", "b", "pt"]);

/**
 * Encodes app state into the URL hash as URLSearchParams.
 * Uses replaceState to avoid polluting browser history.
 */
export function encodeState(state: SerializedState): void {
  const params = new URLSearchParams();
  params.set("d", state.d);
  params.set("c", state.c);
  params.set("r", String(state.r));
  if (state.dt) params.set("dt", state.dt);
  if (state.s) params.set("s", state.s);
  if (state.e) params.set("e", state.e);
  if (state.dm) params.set("dm", state.dm);
  params.set("lng", String(state.lng));
  params.set("lat", String(state.lat));
  params.set("z", String(state.z));
  if (state.b) params.set("b", String(state.b));
  if (state.pt) params.set("pt", String(state.pt));
  if (state.p) {
    for (const [key, value] of Object.entries(state.p)) {
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, v);
      } else {
        params.set(key, value);
      }
    }
  }
  history.replaceState(null, "", `#${params.toString()}`);
}

/**
 * Decodes app state from the URL hash.
 * Returns null if no hash is present or if required fields are missing.
 */
export function decodeState(): SerializedState | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    const params = new URLSearchParams(hash);
    const d = params.get("d");
    const c = params.get("c");
    const r = params.get("r");
    const lngStr = params.get("lng");
    const latStr = params.get("lat");
    const zStr = params.get("z");
    const bStr = params.get("b");
    const ptStr = params.get("pt");
    if (!d || !c || !r || !lngStr || !latStr || !zStr) return null;

    const extraParams: Record<string, string | string[]> = {};
    for (const [key, value] of params.entries()) {
      if (RESERVED.has(key)) continue;
      const existing = extraParams[key];
      if (existing === undefined) {
        extraParams[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        extraParams[key] = [existing, value];
      }
    }

    return {
      d,
      c,
      r: parseInt(r, 10),
      dt: params.get("dt") ?? undefined,
      s: params.get("s") ?? undefined,
      e: params.get("e") ?? undefined,
      dm: params.get("dm") ?? undefined,
      lng: parseFloat(lngStr),
      lat: parseFloat(latStr),
      z: parseFloat(zStr),
      b: bStr ? parseFloat(bStr) : undefined,
      pt: ptStr ? parseFloat(ptStr) : undefined,
      p: Object.keys(extraParams).length > 0 ? extraParams : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the current raw date input values from the DOM by element ID.
 * Returns the appropriate fields for SerializedState based on the date mode.
 */
export function getRawDateFromDom(
  dateMode: string
): Pick<SerializedState, "dt" | "s" | "e"> {
  if (dateMode === "single" || dateMode === "week") {
    const input = document.getElementById("date-input") as HTMLInputElement | null;
    return { dt: input?.value };
  } else if (dateMode === "month") {
    const input = document.getElementById("month-input") as HTMLInputElement | null;
    return { dt: input?.value };
  } else {
    const start = document.getElementById(
      "start-date-input"
    ) as HTMLInputElement | null;
    const end = document.getElementById(
      "end-date-input"
    ) as HTMLInputElement | null;
    return { s: start?.value, e: end?.value };
  }
}
