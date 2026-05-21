import type { Map } from "maplibre-gl";

/**
 * Captures the current map canvas and triggers a PNG download.
 * If `attribution` is provided (an HTML string), it is stripped to plain text
 * and rendered as an overlay in the bottom-right corner of the image.
 * If `label` is provided it is slugified and included in the filename.
 * Requires the map to be initialized with `preserveDrawingBuffer: true`.
 */
export function exportMapImage(
  map: Map,
  attribution?: string,
  datasetSlug?: string,
  collectionSlug?: string,
  label?: string,
  dateStr?: string
): void {
  const mapCanvas = map.getCanvas();
  const { width, height } = mapCanvas;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(mapCanvas, 0, 0);

  if (attribution) {
    const text = attribution.replace(/<[^>]*>/g, "");
    const fontSize = 11;
    const padding = 5;
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    const textWidth = ctx.measureText(text).width;
    const boxW = textWidth + padding * 2;
    const boxH = fontSize + padding * 2;
    const x = width - boxW - 4;
    const y = height - boxH - 4;

    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = "#e8e8e8";
    ctx.fillText(text, x + padding, y + padding + fontSize - 1);
  }

  const datasetPart = datasetSlug ? `-${datasetSlug}` : "";
  const collectionPart = collectionSlug ? `-${collectionSlug}` : "";
  const labelPart = label
    ? "-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")
    : "";
  const datePart = dateStr ? `-${dateStr}` : "";
  const link = document.createElement("a");
  link.download = `titiler-cmr${datasetPart}${collectionPart}${labelPart}${datePart}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}
