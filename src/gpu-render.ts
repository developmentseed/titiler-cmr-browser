import type { Device, Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import {
  COLORMAP_INDEX,
  Colormap,
  createColormapTexture,
  decodeColormapSprite,
  FilterNoDataVal,
  LinearRescale,
  MaskTexture,
  type RasterModule,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapSpriteUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { StyleExpression, ToneAdjustment } from "./config";
import type { CompiledRenderPlan } from "./render-plan";
import type { GpuTileData } from "./titiler-cmr";

const DEFAULT_UV_TRANSFORM = [0, 0, 1, 1] as const;

type ExprModuleProps = {
  band0: Texture;
  band1: Texture;
  band2: Texture;
  band3: Texture;
};

type ToneModuleProps = {
  gamma: number;
  saturation: number;
  sigmoidalContrast: number;
  sigmoidalBias: number;
};

const colormapTextureCache = new WeakMap<Device, Promise<Texture>>();

function getBandTextureName(index: number): string {
  return `band${index - 1}`;
}

function compileExpressionGlsl(expression: StyleExpression): string {
  switch (expression.op) {
    case "band":
      if (expression.band < 1 || expression.band > 4) {
        throw new Error(`GPU expression compiler supports band references 1-4. Received band ${expression.band}.`);
      }
      return `texture(${getBandTextureName(expression.band)}, geometry.uv).r`;
    case "const":
      return Number.isInteger(expression.value)
        ? `${expression.value}.0`
        : String(expression.value);
    case "log10":
      return `log(${compileExpressionGlsl(expression.arg)}) / log(10.0)`;
    case "add":
      return `(${compileExpressionGlsl(expression.args[0])} + ${compileExpressionGlsl(expression.args[1])})`;
    case "sub":
      return `(${compileExpressionGlsl(expression.args[0])} - ${compileExpressionGlsl(expression.args[1])})`;
    case "mul":
      return `(${compileExpressionGlsl(expression.args[0])} * ${compileExpressionGlsl(expression.args[1])})`;
    case "div":
      return `(${compileExpressionGlsl(expression.args[0])} / ${compileExpressionGlsl(expression.args[1])})`;
    default: {
      const exhaustive: never = expression;
      throw new Error(`Unsupported expression: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function createExpressionModule(plan: CompiledRenderPlan): ShaderModule<ExprModuleProps> {
  const samplerDecl = `precision highp float;\nprecision highp int;\n${[0, 1, 2, 3]
    .map((index) => `uniform sampler2D band${index};`)
    .join("\n")}`;

  const expressionBody =
    plan.kind === "scalar"
      ? `
  float scalar = ${compileExpressionGlsl(plan.steps[0].kind === "expression" ? plan.steps[0].expression : { op: "const", value: 0 })};
  if (isnan(scalar) || isinf(scalar)) {
    color = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  color = vec4(scalar, scalar, scalar, 1.0);
`
      : `
  color = vec4(
    ${compileExpressionGlsl(plan.channels[0].expression)},
    ${compileExpressionGlsl(plan.channels[1].expression)},
    ${compileExpressionGlsl(plan.channels[2].expression)},
    1.0
  );
`;

  return {
    name: `expr-${plan.styleKey}`,
    inject: {
      "fs:#decl": samplerDecl,
      "fs:DECKGL_FILTER_COLOR": expressionBody,
    },
    getUniforms: (props) => ({
      band0: props.band0,
      band1: props.band1,
      band2: props.band2,
      band3: props.band3,
    }),
  };
}

function summarizeAdjustments(adjustments: ToneAdjustment[]): Required<ToneModuleProps> {
  const summary: Required<ToneModuleProps> = {
    gamma: 1,
    saturation: 1,
    sigmoidalContrast: 0,
    sigmoidalBias: 0.5,
  };

  for (const adjustment of adjustments) {
    if (adjustment.kind === "gamma") {
      summary.gamma = adjustment.value;
    } else if (adjustment.kind === "saturation") {
      summary.saturation = adjustment.value;
    } else {
      summary.sigmoidalContrast = adjustment.contrast;
      summary.sigmoidalBias = adjustment.bias;
    }
  }

  return summary;
}

function createToneAdjustmentModule(adjustments: ToneAdjustment[]): RasterModule<ToneModuleProps> | null {
  if (adjustments.length === 0) {
    return null;
  }

  const props = summarizeAdjustments(adjustments);
  const module: ShaderModule<ToneModuleProps> = {
    name: `tone-${props.gamma}-${props.saturation}-${props.sigmoidalContrast}-${props.sigmoidalBias}`,
    fs: `uniform toneAdjustUniforms {
  float gamma;
  float saturation;
  float sigmoidalContrast;
  float sigmoidalBias;
} toneAdjust;
`,
    uniformTypes: {
      gamma: "f32",
      saturation: "f32",
      sigmoidalContrast: "f32",
      sigmoidalBias: "f32",
    },
    inject: {
      "fs:DECKGL_FILTER_COLOR": `
  vec3 adjusted = clamp(color.rgb, 0.0, 1.0);
  adjusted = pow(adjusted, vec3(1.0 / max(toneAdjust.gamma, 0.0001)));
  float luma = dot(adjusted, vec3(0.2126, 0.7152, 0.0722));
  adjusted = clamp(vec3(luma) + (adjusted - vec3(luma)) * toneAdjust.saturation, 0.0, 1.0);
  if (toneAdjust.sigmoidalContrast > 0.0) {
    adjusted = clamp(
      1.0 / (1.0 + exp(-toneAdjust.sigmoidalContrast * (adjusted - vec3(toneAdjust.sigmoidalBias)))),
      0.0,
      1.0
    );
  }
  color = vec4(adjusted, color.a);
`,
    },
    getUniforms: () => props,
  };

  return { module, props };
}

export async function getColormapTexture(device: Device): Promise<Texture> {
  let pending = colormapTextureCache.get(device);
  if (!pending) {
    pending = fetch(colormapSpriteUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load colormap sprite: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((buffer) => decodeColormapSprite(buffer))
      .then((imageData) => createColormapTexture(device, imageData));
    colormapTextureCache.set(device, pending);
  }
  return pending;
}

function getBandTextures(tile: GpuTileData): [Texture, Texture, Texture, Texture] {
  const first = tile.bandTextures[0];
  if (!first) {
    throw new Error("Expected at least one band texture.");
  }
  return [
    tile.bandTextures[0] ?? first,
    tile.bandTextures[1] ?? first,
    tile.bandTextures[2] ?? first,
    tile.bandTextures[3] ?? first,
  ];
}

function getSharedRgbRescaleRange(plan: Extract<CompiledRenderPlan, { kind: "rgb" }>): [number, number] | null {
  const [first, ...rest] = plan.channels.map((channel) => channel.rescale);
  if (!first) {
    return null;
  }

  return rest.every((range) => range && range[0] === first[0] && range[1] === first[1])
    ? first
    : null;
}

export function renderTileWithGpuModules(
  tile: GpuTileData,
  plan: CompiledRenderPlan,
): { renderPipeline: RasterModule[] } {
  const [band0, band1, band2, band3] = getBandTextures(tile);
  const pipeline: RasterModule[] = [
    {
      module: createExpressionModule(plan),
      props: { band0, band1, band2, band3 },
    },
  ];

  if (plan.kind === "scalar" && plan.alphaBand !== undefined) {
    const maskTexture = [band0, band1, band2, band3][plan.alphaBand - 1];
    if (maskTexture) {
      pipeline.push({
        module: MaskTexture,
        props: { maskTexture },
      });
    }
  }

  if (plan.kind === "scalar") {
    const rescaleStep = plan.steps[1];
    const colormapStep = plan.steps[2];
    if (rescaleStep.kind !== "linear-rescale" || colormapStep.kind !== "colormap") {
      throw new Error("Unexpected scalar render plan step ordering.");
    }
    const [min, max] = rescaleStep.range;
    const colormapName = colormapStep.colormapName;
    const reversed = colormapName.endsWith("_r");
    const baseName = reversed ? colormapName.slice(0, -2) : colormapName;
    const colormapIndex = COLORMAP_INDEX[baseName as keyof typeof COLORMAP_INDEX];

    if (colormapIndex === undefined) {
      throw new Error(`Unsupported deck.gl colormap: ${colormapName}`);
    }

    if (plan.nodata !== undefined) {
      pipeline.push({
        module: FilterNoDataVal,
        props: { value: plan.nodata },
      });
    }
    pipeline.push({
      module: LinearRescale,
      props: {
        rescaleMin: min,
        rescaleMax: max,
      },
    });
    if (!tile.colormapTexture) {
      throw new Error("Missing colormap texture for scalar GPU render plan.");
    }

    pipeline.push({
      module: Colormap,
      props: {
        colormapTexture: tile.colormapTexture,
        colormapIndex,
        reversed,
      },
    });
    return { renderPipeline: pipeline };
  }

  const sharedRange = getSharedRgbRescaleRange(plan);
  if (!sharedRange) {
    throw new Error("GPU RGB rendering currently requires one shared rescale range across all channels.");
  }

  pipeline.push({
    module: LinearRescale,
    props: {
      rescaleMin: sharedRange[0],
      rescaleMax: sharedRange[1],
    },
  });

  const toneModule = createToneAdjustmentModule(plan.adjustments);
  if (toneModule) {
    pipeline.push(toneModule as RasterModule);
  }

  return { renderPipeline: pipeline };
}

export function destroyGpuTileResources(tile: GpuTileData): void {
  for (const texture of tile.bandTextures) {
    texture.destroy();
  }
}

export { DEFAULT_UV_TRANSFORM };
