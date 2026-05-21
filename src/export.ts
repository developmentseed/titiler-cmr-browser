import type { Map } from "maplibre-gl";

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function buildExportFilename(
  datasetSlug?: string,
  collectionSlug?: string,
  label?: string,
  dateStr?: string,
): string {
  const datasetPart = datasetSlug ? `-${slugify(datasetSlug)}` : "";
  const collectionPart = collectionSlug ? `-${slugify(collectionSlug)}` : "";
  const labelPart = label ? `-${slugify(label)}` : "";
  const datePart = dateStr ? `-${dateStr}` : "";
  return `titiler-cmr${datasetPart}${collectionPart}${labelPart}${datePart}.png`;
}

/**
 * Captures the current map canvas and triggers a PNG download.
 * If `attribution` is provided (an HTML string), it is stripped to plain text
 * and rendered as an overlay in the bottom-right corner of the image.
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
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create 2D export canvas context.");
  }

  ctx.drawImage(mapCanvas, 0, 0);

  if (attribution) {
    const text = stripHtml(attribution);
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

  const link = document.createElement("a");
  link.download = buildExportFilename(datasetSlug, collectionSlug, label, dateStr);
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export const __test__ = {
  buildExportFilename,
  stripHtml,
  slugify,
};
