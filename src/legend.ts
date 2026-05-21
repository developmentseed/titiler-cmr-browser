import { fetchColormap } from "./colormap";
import type { LegendSpec } from "./state";

/** Draws the colormap vertically: index 255 (max) at top, index 0 (min) at bottom. */
function drawGradient(
  canvas: HTMLCanvasElement,
  data: Record<string, [number, number, number, number]>,
): void {
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < 256; i++) {
    const [r, g, b, a] = data[String(255 - i)] ?? [0, 0, 0, 255];
    ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
    ctx.fillRect(0, i, 1, 1);
  }
}

/** Updates the #legend overlay from derived client-side legend metadata. */
let renderVersion = 0;

export function updateLegend(legend: LegendSpec): void {
  const el = document.getElementById("legend")!;
  const currentVersion = ++renderVersion;

  if (legend.kind !== "colormap") {
    el.innerHTML = "";
    el.classList.remove("visible");
    return;
  }

  const [min, max] = legend.range;

  fetchColormap(legend.colormapName).then((data) => {
    if (currentVersion !== renderVersion) {
      return;
    }

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

    if (legend.units) {
      const units = document.createElement("div");
      units.className = "legend-units";
      units.textContent = legend.units;
      el.appendChild(units);
    }

    el.classList.add("visible");
  });
}
