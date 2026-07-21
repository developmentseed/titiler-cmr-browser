import type {
  CollectionConfig,
  FetchConfig,
  RenderConfig,
  RgbExpressionOption,
  ScalarStyleConfig,
  StyleConfig,
  StyleExpression,
  StyleExpressionRef,
  StyleSelectorConfig,
  SubLayerSpec,
  ToneAdjustment,
} from "./config";
import type { ControlState } from "./controls";

export type ParamValue = string | string[];
export type ParamBag = Record<string, ParamValue>;

export type RawBandRequestSpec = {
  bandRef: string;
  /** bandRequestKey changes only when one fetchable raw band tile would change. */
  bandRequestKey: string;
};

export type ActiveSourceDefinition = {
  /** sourceKey owns deck layer identity for the logical raw source selection. */
  sourceKey: string;
  backend: CollectionConfig["backend"];
  collectionConceptId: string;
  datetime: string;
  assets?: string[];
  variables?: string[];
  params: ParamBag;
  rawBandRequests: RawBandRequestSpec[];
  minzoom: number;
  maxzoom?: number;
  attribution?: string;
};

export type LegendSpec =
  | {
      kind: "colormap";
      colormapName: string;
      range: [number, number];
      units?: string;
    }
  | { kind: "none" };

export type ResolvedRgbChannel = {
  expression: StyleExpression;
  selectorKey?: string;
  selectedValue?: string;
  rescale?: [number, number];
};

export type ResolvedRgbStylePlan = {
  kind: "rgb";
  /** styleKey owns rerender invalidation for style-only changes. */
  styleKey: string;
  selectorValues: Record<string, string>;
  channels: [ResolvedRgbChannel, ResolvedRgbChannel, ResolvedRgbChannel];
  alphaBand?: number;
  adjustments?: ToneAdjustment[];
  legend: LegendSpec;
};

export type ResolvedScalarStylePlan = {
  kind: "scalar";
  /** styleKey owns rerender invalidation for style-only changes. */
  styleKey: string;
  selectorValues: Record<string, string>;
  expression: StyleExpression;
  rescale: [number, number];
  colormapName: string;
  nodata?: number;
  alphaBand?: number;
  units?: string;
  legend: LegendSpec;
};

export type ClientRenderPlan = ResolvedRgbStylePlan | ResolvedScalarStylePlan;

export type DerivedLayerState = {
  source: ActiveSourceDefinition;
  style: ClientRenderPlan;
  minzoom: number;
  maxzoom?: number;
};

export type DerivedRasterState = {
  layers: DerivedLayerState[];
  effectiveMinZoom: number;
};

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function cloneParamValue(value: ParamValue): ParamValue {
  return Array.isArray(value) ? [...value] : value;
}

function copyParams(params?: ParamBag): ParamBag {
  return Object.fromEntries(
    Object.entries(params ?? {}).map(([key, value]) => [key, cloneParamValue(value)]),
  );
}

function getStyleSelectors(render: RenderConfig): StyleSelectorConfig[] {
  return render.style.kind === "rgb" ? [...(render.style.selectors ?? [])] : [];
}

function getScalarColormapParamKey(render: RenderConfig): string | undefined {
  return render.style.kind === "scalar" ? render.style.colormapParamKey : undefined;
}

function getScalarColormapValue(
  render: RenderConfig,
  extraParams: ParamBag,
): string | undefined {
  if (render.style.kind !== "scalar") {
    return undefined;
  }

  const key = render.style.colormapParamKey;
  if (!key) {
    return undefined;
  }

  const raw = extraParams[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    return undefined;
  }

  return render.style.colormapOptions?.some((option) => option.value === value)
    ? value
    : undefined;
}

function getSelectorDefaults(render: RenderConfig): Record<string, string> {
  return Object.fromEntries(
    getStyleSelectors(render).map((selector) => [selector.key, selector.default]),
  );
}

function getSelectorOption(
  selector: StyleSelectorConfig,
  value: string,
): RgbExpressionOption {
  return (
    selector.options.find((option) => option.value === value) ??
    selector.options.find((option) => option.value === selector.default) ??
    selector.options[0]
  );
}

function getSelectorValues(
  render: RenderConfig,
  extraParams: ParamBag,
): Record<string, string> {
  const defaults = getSelectorDefaults(render);
  return Object.fromEntries(
    getStyleSelectors(render).map((selector) => {
      const raw = extraParams[selector.key];
      const value = Array.isArray(raw) ? raw[0] : raw;
      const option = getSelectorOption(selector, value ?? defaults[selector.key]);
      return [selector.key, option.value];
    }),
  );
}

function splitExtraParams(
  render: RenderConfig,
  extraParams: ParamBag,
): {
  sourceParams: ParamBag;
  selectorValues: Record<string, string>;
  scalarColormapName?: string;
} {
  const styleOnlyKeys = new Set(getStyleSelectors(render).map((selector) => selector.key));
  const scalarColormapParamKey = getScalarColormapParamKey(render);
  if (scalarColormapParamKey) {
    styleOnlyKeys.add(scalarColormapParamKey);
  }
  const sourceParams: ParamBag = {};

  for (const [key, value] of Object.entries(extraParams)) {
    if (styleOnlyKeys.has(key)) {
      continue;
    }
    sourceParams[key] = cloneParamValue(value);
  }

  return {
    sourceParams,
    selectorValues: getSelectorValues(render, extraParams),
    scalarColormapName: getScalarColormapValue(render, extraParams),
  };
}

function buildSourceParams(
  collection: CollectionConfig,
  fetch: FetchConfig,
  extraParams: ParamBag,
  subLayer?: SubLayerSpec,
): ParamBag {
  const params = copyParams(fetch.params);

  if (collection.assetsRegex) {
    params.assets_regex = collection.assetsRegex;
  }

  for (const [key, value] of Object.entries(extraParams)) {
    params[key] = cloneParamValue(value);
  }

  if (subLayer) {
    for (const [key, value] of Object.entries(subLayer.params)) {
      params[key] = value;
    }
  }

  return params;
}

function buildRawBandRequests(args: {
  backend: CollectionConfig["backend"];
  collectionConceptId: string;
  datetime: string;
  assets?: string[];
  variables?: string[];
  params: ParamBag;
}): RawBandRequestSpec[] {
  const bandRefs = args.backend === "rasterio" ? args.assets ?? [] : args.variables ?? [];

  return bandRefs.map((bandRef) => {
    const bandPayload = {
      backend: args.backend,
      collectionConceptId: args.collectionConceptId,
      datetime: args.datetime,
      bandRef,
      params: args.params,
    };

    return {
      bandRef,
      bandRequestKey: stableSerialize(bandPayload),
    };
  });
}

function buildSourceDefinition(
  state: ControlState,
  extraParams: ParamBag,
  subLayer?: SubLayerSpec,
): ActiveSourceDefinition {
  const { collection, render, datetime } = state;
  const params = buildSourceParams(collection, render.fetch, extraParams, subLayer);
  const minzoom = subLayer?.minzoom ?? collection.minzoom;
  const maxzoom = subLayer?.maxzoom ?? collection.maxzoom;
  const assets = render.fetch.assets ? [...render.fetch.assets] : undefined;
  const variables = render.fetch.variables ? [...render.fetch.variables] : undefined;

  const sourcePayload = {
    backend: collection.backend,
    collectionConceptId: collection.collectionConceptId,
    datetime,
    assets,
    variables,
    params,
    minzoom,
    maxzoom,
  };

  return {
    sourceKey: stableSerialize(sourcePayload),
    backend: collection.backend,
    collectionConceptId: collection.collectionConceptId,
    datetime,
    assets,
    variables,
    params,
    rawBandRequests: buildRawBandRequests({
      backend: collection.backend,
      collectionConceptId: collection.collectionConceptId,
      datetime,
      assets,
      variables,
      params,
    }),
    minzoom,
    maxzoom,
    attribution: collection.attribution,
  };
}

function resolveExpressionRef(
  ref: StyleExpressionRef,
  selectors: StyleSelectorConfig[],
  selectorValues: Record<string, string>,
): ResolvedRgbChannel {
  if ("selectorKey" in ref) {
    const selector = selectors.find((item) => item.key === ref.selectorKey);
    if (!selector) {
      throw new Error(`Unknown style selector: ${ref.selectorKey}`);
    }
    const option = getSelectorOption(selector, selectorValues[selector.key] ?? selector.default);
    return {
      expression: option.compiled,
      selectorKey: selector.key,
      selectedValue: option.value,
      rescale: option.rescale,
    };
  }

  if ("expression" in ref) {
    return {
      expression: ref.expression,
      rescale: ref.rescale,
    };
  }

  return { expression: ref };
}

function buildRgbStylePlan(
  style: Extract<StyleConfig, { kind: "rgb" }>,
  selectorValues: Record<string, string>,
): ResolvedRgbStylePlan {
  const selectors = style.selectors ?? [];
  const channels = style.channels.map((channel) =>
    resolveExpressionRef(channel, selectors, selectorValues),
  ) as [ResolvedRgbChannel, ResolvedRgbChannel, ResolvedRgbChannel];

  const stylePayload = {
    kind: style.kind,
    selectorValues,
    channels: channels.map((channel) => ({
      expression: channel.expression,
      selectorKey: channel.selectorKey,
      selectedValue: channel.selectedValue,
      rescale: channel.rescale,
    })),
    alphaBand: style.alphaBand,
    adjustments: style.adjustments,
  };

  return {
    kind: "rgb",
    styleKey: stableSerialize(stylePayload),
    selectorValues,
    channels,
    alphaBand: style.alphaBand,
    adjustments: style.adjustments,
    legend: { kind: "none" },
  };
}

function buildScalarStylePlan(
  style: ScalarStyleConfig,
  selectorValues: Record<string, string>,
  colormapName = style.colormapName,
): ResolvedScalarStylePlan {
  const stylePayload = {
    kind: style.kind,
    selectorValues,
    expression: style.expression,
    rescale: style.rescale,
    colormapName,
    nodata: style.nodata,
    alphaBand: style.alphaBand,
    units: style.units,
  };

  return {
    kind: "scalar",
    styleKey: stableSerialize(stylePayload),
    selectorValues,
    expression: style.expression,
    rescale: [...style.rescale] as [number, number],
    colormapName,
    nodata: style.nodata,
    alphaBand: style.alphaBand,
    units: style.units,
    legend: {
      kind: "colormap",
      colormapName,
      range: [...style.rescale] as [number, number],
      units: style.units,
    },
  };
}

export function deriveClientRenderPlan(state: ControlState): ClientRenderPlan {
  const { selectorValues, scalarColormapName } = splitExtraParams(
    state.render,
    state.extraParams,
  );
  return state.render.style.kind === "rgb"
    ? buildRgbStylePlan(state.render.style, selectorValues)
    : buildScalarStylePlan(state.render.style, selectorValues, scalarColormapName);
}

export function deriveActiveSources(state: ControlState): ActiveSourceDefinition[] {
  const { sourceParams } = splitExtraParams(state.render, state.extraParams);
  const subLayers = state.render.subLayers;
  if (!subLayers || subLayers.length === 0) {
    return [buildSourceDefinition(state, sourceParams)];
  }
  return subLayers.map((subLayer) => buildSourceDefinition(state, sourceParams, subLayer));
}

export function deriveRasterState(state: ControlState): DerivedRasterState {
  const style = deriveClientRenderPlan(state);
  const sources = deriveActiveSources(state);
  const layers = sources.map((source) => ({
    source,
    style,
    minzoom: source.minzoom,
    maxzoom: source.maxzoom,
  }));
  const effectiveMinZoom = Math.min(...layers.map((layer) => layer.minzoom));

  return {
    layers,
    effectiveMinZoom,
  };
}

