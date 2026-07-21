import type {
  ClientRenderPlan,
  ResolvedRgbChannel,
} from "./state";
import type { StyleExpression, ToneAdjustment } from "./config";

export type CompiledScalarRenderPlan = {
  kind: "scalar";
  styleKey: string;
  expression: StyleExpression;
  rescale: [number, number];
  colormapName: string;
  nodata?: number;
  alphaBand?: number;
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
};

export type CompiledRenderPlan = CompiledScalarRenderPlan | CompiledRgbRenderPlan;

export function compileRenderPlan(style: ClientRenderPlan): CompiledRenderPlan {
  if (style.kind === "scalar") {
    return {
      kind: "scalar",
      styleKey: style.styleKey,
      expression: style.expression,
      rescale: style.rescale,
      colormapName: style.colormapName,
      nodata: style.nodata,
      alphaBand: style.alphaBand,
    };
  }

  return {
    kind: "rgb",
    styleKey: style.styleKey,
    channels: style.channels.map((channel: ResolvedRgbChannel) => ({
      expression: channel.expression,
      rescale: channel.rescale,
    })) as [CompiledRgbChannelPlan, CompiledRgbChannelPlan, CompiledRgbChannelPlan],
    alphaBand: style.alphaBand,
    adjustments: style.adjustments ?? [],
  };
}
