import { TITILER_ENDPOINT } from "./config";
import type { ControlState } from "./controls";

type ColormapData = Record<string, [number, number, number, number]>;

const cache = new Map<string, ColormapData>();

async function fetchColormap(name: string): Promise<ColormapData> {
  if (cache.has(name)) return cache.get(name)!;
  const res = await fetch(`${TITILER_ENDPOINT}/colorMaps/${name}?f=json`);
  const data: ColormapData = await res.json();
  cache.set(name, data);
  return data;
}

/** Draws the colormap vertically: index 255 (max) at top, index 0 (min) at bottom. */
function drawGradient(canvas: HTMLCanvasElement, data: ColormapData): void {
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < 256; i++) {
    const [r, g, b, a] = data[String(255 - i)] ?? [0, 0, 0, 255];
    ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
    ctx.fillRect(0, i, 1, 1);
  }
}

/** Updates the #legend overlay to reflect the current render's colormap.
 *  Hidden when the render has no colormap_name or no rescale. */
export function updateLegend(state: ControlState): void {
  const el = document.getElementById("legend")!;
  const { render } = state;
  const colormapName = render.params.colormap_name;
  const rescale = render.rescale;

  if (typeof colormapName !== "string" || !rescale || rescale.length === 0) {
    el.classList.remove("visible");
    return;
  }

  const [min, max] = rescale[0];

  fetchColormap(colormapName).then((data) => {
    el.innerHTML = "";

    const canvas = document.createElement("canvas");
    drawGradient(canvas, data);

    const ticks = document.createElement("div");
    ticks.className = "legend-ticks";
    ticks.innerHTML = `<span>${max}</span><span>${min}</span>`;

    const gradient = document.createElement("div");
    gradient.className = "legend-gradient";
    gradient.appendChild(canvas);
    gradient.appendChild(ticks);

    el.appendChild(gradient);

    if (render.units) {
      const units = document.createElement("div");
      units.className = "legend-units";
      units.textContent = render.units;
      el.appendChild(units);
    }

    el.classList.add("visible");
  });
}
