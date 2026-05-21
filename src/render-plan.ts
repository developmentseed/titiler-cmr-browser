import type { DecodedTileData } from "./titiler-cmr";
import type {
  ClientRenderPlan,
  ResolvedRgbChannel,
  ResolvedRgbStylePlan,
  ResolvedScalarStylePlan,
} from "./state";
import type { StyleExpression, ToneAdjustment } from "./config";

export type ScalarRenderStep =
  | { kind: "expression"; expression: StyleExpression }
  | { kind: "linear-rescale"; range: [number, number] }
  | { kind: "colormap"; colormapName: string };

export type CompiledScalarRenderPlan = {
  kind: "scalar";
  styleKey: string;
  steps: [ScalarRenderStep, ScalarRenderStep, ScalarRenderStep];
  nodata?: number;
  alphaBand?: number;
  renderTile: (tile: DecodedTileData) => ImageData;
};

export type CompiledRgbChannelPlan = {
  expression: StyleExpression;
  rescale?: [number, number];
};

export type CompiledRgbRenderPlan = {
  kind: "rgb";
  styleKey: string;
  channels: [CompiledRgbChannelPlan, CompiledRgbChannelPlan, CompiledRgbChannelPlan];
  alphaBand?: number;
  adjustments: ToneAdjustment[];
  renderTile: (tile: DecodedTileData) => ImageData;
};

export type CompiledRenderPlan = CompiledScalarRenderPlan | CompiledRgbRenderPlan;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getBandValue(tile: DecodedTileData, band: number, pixelIndex: number): number {
  const { ndarray } = tile;
  if (ndarray.shape.length === 2) {
    if (band !== 1) {
      throw new Error(`Tile only exposes 1 band; cannot read band ${band}.`);
    }
    return Number(ndarray.data[pixelIndex]);
  }

  if (band < 1 || band > ndarray.bandCount) {
    throw new Error(`Band ${band} is outside the tile band range 1-${ndarray.bandCount}.`);
  }

  const bandOffset = (band - 1) * ndarray.width * ndarray.height;
  return Number(ndarray.data[bandOffset + pixelIndex]);
}

export function evaluateStyleExpression(
  expression: StyleExpression,
  tile: DecodedTileData,
  pixelIndex: number,
): number {
  switch (expression.op) {
    case "band":
      return getBandValue(tile, expression.band, pixelIndex);
    case "const":
      return expression.value;
    case "log10":
      return Math.log10(evaluateStyleExpression(expression.arg, tile, pixelIndex));
    case "add":
      return (
        evaluateStyleExpression(expression.args[0], tile, pixelIndex) +
        evaluateStyleExpression(expression.args[1], tile, pixelIndex)
      );
    case "sub":
      return (
        evaluateStyleExpression(expression.args[0], tile, pixelIndex) -
        evaluateStyleExpression(expression.args[1], tile, pixelIndex)
      );
    case "mul":
      return (
        evaluateStyleExpression(expression.args[0], tile, pixelIndex) *
        evaluateStyleExpression(expression.args[1], tile, pixelIndex)
      );
    case "div":
      return (
        evaluateStyleExpression(expression.args[0], tile, pixelIndex) /
        evaluateStyleExpression(expression.args[1], tile, pixelIndex)
      );
    default: {
      const exhaustive: never = expression;
      throw new Error(`Unsupported style expression: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function normalize(value: number, range: [number, number]): number {
  const [min, max] = range;
  if (max === min) {
    return 0;
  }
  return clamp01((value - min) / (max - min));
}

function inferRange(values: Float32Array): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [0, 1];
  }

  return [min, max];
}

function applyGamma(value: number, gamma: number): number {
  if (gamma <= 0) {
    return value;
  }
  return clamp01(Math.pow(clamp01(value), 1 / gamma));
}

function applySaturation(rgb: [number, number, number], saturation: number): [number, number, number] {
  const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return [
    clamp01(luma + (rgb[0] - luma) * saturation),
    clamp01(luma + (rgb[1] - luma) * saturation),
    clamp01(luma + (rgb[2] - luma) * saturation),
  ];
}

function applySigmoidal(value: number, contrast: number, bias: number): number {
  if (contrast === 0) {
    return clamp01(value);
  }

  const numerator =
    1 / (1 + Math.exp(contrast * (bias - value))) -
    1 / (1 + Math.exp(contrast * bias));
  const denominator =
    1 / (1 + Math.exp(contrast * (bias - 1))) -
    1 / (1 + Math.exp(contrast * bias));

  if (denominator === 0) {
    return clamp01(value);
  }

  return clamp01(numerator / denominator);
}

function applyAdjustments(
  rgb: [number, number, number],
  adjustments: ToneAdjustment[],
): [number, number, number] {
  let current = rgb;

  for (const adjustment of adjustments) {
    if (adjustment.kind === "gamma") {
      current = [
        applyGamma(current[0], adjustment.value),
        applyGamma(current[1], adjustment.value),
        applyGamma(current[2], adjustment.value),
      ];
      continue;
    }

    if (adjustment.kind === "saturation") {
      current = applySaturation(current, adjustment.value);
      continue;
    }

    current = [
      applySigmoidal(current[0], adjustment.contrast, adjustment.bias),
      applySigmoidal(current[1], adjustment.contrast, adjustment.bias),
      applySigmoidal(current[2], adjustment.contrast, adjustment.bias),
    ];
  }

  return current;
}

function renderScalarTile(style: ResolvedScalarStylePlan, tile: DecodedTileData): ImageData {
  const pixelCount = tile.width * tile.height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  const alphaValues = style.alphaBand
    ? evaluateRgbChannel({ expression: { op: "band", band: style.alphaBand } }, tile)
    : null;

  for (let i = 0; i < pixelCount; i++) {
    const value = evaluateStyleExpression(style.expression, tile, i);
    const isTransparent =
      !Number.isFinite(value) ||
      value === style.nodata ||
      (alphaValues ? alphaValues[i] <= 0 : false);
    const offset = i * 4;

    if (isTransparent) {
      rgba[offset + 3] = 0;
      continue;
    }

    const normalized = normalize(value, style.rescale);
    const channel = Math.round(normalized * 255);
    rgba[offset] = channel;
    rgba[offset + 1] = channel;
    rgba[offset + 2] = channel;
    rgba[offset + 3] = 255;
  }

  return new ImageData(rgba, tile.width, tile.height);
}

function evaluateRgbChannel(channel: ResolvedRgbChannel, tile: DecodedTileData): Float32Array {
  const pixelCount = tile.width * tile.height;
  const values = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    values[i] = evaluateStyleExpression(channel.expression, tile, i);
  }
  return values;
}

function renderRgbTile(style: ResolvedRgbStylePlan, tile: DecodedTileData): ImageData {
  const pixelCount = tile.width * tile.height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  const channels = style.channels.map((channel) => ({
    values: evaluateRgbChannel(channel, tile),
    range: channel.rescale,
  })) as Array<{ values: Float32Array; range?: [number, number] }>;
  const ranges = channels.map((channel) => channel.range ?? inferRange(channel.values));
  const alphaValues = style.alphaBand
    ? evaluateRgbChannel({ expression: { op: "band", band: style.alphaBand } }, tile)
    : null;

  for (let i = 0; i < pixelCount; i++) {
    const alpha = alphaValues ? (alphaValues[i] > 0 ? 255 : 0) : 255;
    const offset = i * 4;
    rgba[offset + 3] = alpha;

    if (alpha === 0) {
      continue;
    }

    const adjusted = applyAdjustments(
      [
        normalize(channels[0].values[i], ranges[0]),
        normalize(channels[1].values[i], ranges[1]),
        normalize(channels[2].values[i], ranges[2]),
      ],
      style.adjustments ?? [],
    );

    rgba[offset] = Math.round(adjusted[0] * 255);
    rgba[offset + 1] = Math.round(adjusted[1] * 255);
    rgba[offset + 2] = Math.round(adjusted[2] * 255);
  }

  return new ImageData(rgba, tile.width, tile.height);
}

export function compileRenderPlan(style: ClientRenderPlan): CompiledRenderPlan {
  if (style.kind === "scalar") {
    return {
      kind: "scalar",
      styleKey: style.styleKey,
      steps: [
        { kind: "expression", expression: style.expression },
        { kind: "linear-rescale", range: style.rescale },
        { kind: "colormap", colormapName: style.colormapName },
      ],
      nodata: style.nodata,
      alphaBand: style.alphaBand,
      renderTile: (tile) => renderScalarTile(style, tile),
    };
  }

  return {
    kind: "rgb",
    styleKey: style.styleKey,
    channels: style.channels.map((channel) => ({
      expression: channel.expression,
      rescale: channel.rescale,
    })) as [CompiledRgbChannelPlan, CompiledRgbChannelPlan, CompiledRgbChannelPlan],
    alphaBand: style.alphaBand,
    adjustments: style.adjustments ?? [],
    renderTile: (tile) => renderRgbTile(style, tile),
  };
}
