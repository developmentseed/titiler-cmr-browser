export const TITILER_ENDPOINT =
  "https://staging.openveda.cloud/api/titiler-cmr";

/** A single sub-layer within a multi-layer render (e.g. NISAR frequencyA/B). */
export type SubLayerSpec = {
  /** Extra/override params for this sub-layer (e.g. `group` for xarray). */
  params: Record<string, string>;
  minzoom: number;
  maxzoom?: number;
};

export type StyleExpression =
  | { op: "band"; band: number }
  | { op: "const"; value: number }
  | { op: "log10"; arg: StyleExpression }
  | {
      op: "add" | "sub" | "mul" | "div";
      args: [StyleExpression, StyleExpression];
    };

export type StyleExpressionRef =
  | StyleExpression
  | {
      expression: StyleExpression;
      rescale?: [number, number];
    }
  | {
      selectorKey: string;
    };

export type RgbExpressionOption = {
  label: string;
  value: string;
  /** Client-side typed expression used by selector-driven RGB styles. */
  compiled: StyleExpression;
  /** Suggested [min, max] rescale for this channel when used in an RGB composite. */
  rescale?: [number, number];
};

export type StyleSelectorConfig = {
  key: string;
  label: string;
  options: RgbExpressionOption[];
  default: string;
};

export type ToneAdjustment =
  | { kind: "gamma"; value: number }
  | { kind: "saturation"; value: number }
  | { kind: "sigmoidal"; contrast: number; bias: number };

export type FetchConfig = {
  /** Asset names for rasterio backends (for example ["B04", "B03", "B02"]). */
  assets?: string[];
  /** Variable names for xarray backends (for example ["analysed_sst"]). */
  variables?: string[];
  /** Source-affecting request params merged into raw-tile requests. */
  params?: Record<string, string | string[]>;
};

export type RgbStyleConfig = {
  kind: "rgb";
  channels: [StyleExpressionRef, StyleExpressionRef, StyleExpressionRef];
  /** Optional source band to use as an alpha/mask channel. */
  alphaBand?: number;
  selectors?: StyleSelectorConfig[];
  adjustments?: ToneAdjustment[];
};

export type ScalarStyleConfig = {
  kind: "scalar";
  expression: StyleExpression;
  rescale: [number, number];
  colormapName: string;
  colormapParamKey?: string;
  colormapOptions?: { label: string; value: string }[];
  /** Optional post-expression nodata value to discard / render transparent. */
  nodata?: number;
  /** Optional source band to use as an alpha / mask channel. */
  alphaBand?: number;
  units?: string;
};

export type StyleConfig = RgbStyleConfig | ScalarStyleConfig;

export type RenderConfig = {
  label: string;
  fetch: FetchConfig;
  style: StyleConfig;
  /** When present, produces one map layer per entry instead of a single layer. */
  subLayers?: SubLayerSpec[];
};

/**
 * Controls the date picker UI and how the `datetime` query param is formed.
 * - `single`: one date input; datetime sent as a single-day range.
 * - `range`: two date inputs (start / end).
 * - `month`: a single month/year picker; datetime sent as the full calendar month range.
 * - `week`: one date input (week start); datetime sent as a 7-day range.
 * - `switchable`: renders mode tabs (Monthly/Daily/Weekly/Custom) above the date
 *   controls. `defaultMode` sets the initially active tab.
 *
 * `default` is optional; when omitted the UI computes a smart default from the
 * current date (yesterday for single/week, last month for month, last 30 days for range).
 */
export type DateConfig =
  | { mode: "single"; default?: string }
  | { mode: "range"; default?: [string, string] }
  | { mode: "month"; default?: string }
  | { mode: "week"; default?: string }
  | {
      mode: "switchable";
      defaultMode: "month" | "single" | "week" | "range";
      default?: string | [string, string];
    };

/**
 * A numeric range input rendered as two number fields (min, max).
 * Serialized as "min,max" (e.g. "0,40").
 */
export type RangeQueryParam = {
  type: "range";
  label: string;
  key: string;
  min: number;
  max: number;
  step?: number;
  default: [number, number];
};

/** A fixed-choice dropdown. Value sent as-is. */
export type SelectQueryParam = {
  type: "select";
  label: string;
  key: string;
  options: { label: string; value: string }[];
  default: string;
};

/** A free-text input. Value sent as-is. */
export type TextQueryParam = {
  type: "text";
  label: string;
  key: string;
  default: string;
};

/**
 * A CMR additional-attribute filter.
 * Serialized as `attribute=attributeType,attributeName,value`.
 * Multiple attribute params accumulate as a string[] under the "attribute" key.
 * A null value means no filter — the param is omitted entirely.
 */
export type AttributeQueryParam = {
  type: "attribute";
  label: string;
  attributeType: "int" | "string";
  attributeName: string;
  /** When provided, renders as a select. Include a null-value entry for "no filter". */
  options?: { label: string; value: string | null }[];
  default: string | null;
};

export type QueryParamConfig =
  | RangeQueryParam
  | SelectQueryParam
  | TextQueryParam
  | AttributeQueryParam;

export type CollectionConfig = {
  label: string;
  /** Short slug included in export filenames (useful when a dataset has multiple collections). */
  slug?: string;
  collectionConceptId: string;
  assetsRegex?: string;
  minzoom: number;
  maxzoom: number;
  backend: "rasterio" | "xarray";
  /** HTML string shown in the MapLibre attribution control for this layer. */
  attribution?: string;
  /** Controls the date picker UI and the datetime query param format. */
  date: DateConfig;
  renders: RenderConfig[];
  /** Optional extra query parameters surfaced as UI controls. */
  queryParams?: QueryParamConfig[];
};

export type DatasetConfig = {
  id: string;
  label: string;
  /**
   * A single CollectionConfig hides the collection selector in the UI.
   * An array shows it, allowing the user to switch between collections.
   */
  collection: CollectionConfig | CollectionConfig[];
};

const band = (index: number): StyleExpression => ({ op: "band", band: index });
const constant = (value: number): StyleExpression => ({ op: "const", value });
const log10 = (arg: StyleExpression): StyleExpression => ({ op: "log10", arg });
const add = (
  left: StyleExpression,
  right: StyleExpression,
): StyleExpression => ({ op: "add", args: [left, right] });
const sub = (
  left: StyleExpression,
  right: StyleExpression,
): StyleExpression => ({ op: "sub", args: [left, right] });
const mul = (
  left: StyleExpression,
  right: StyleExpression,
): StyleExpression => ({ op: "mul", args: [left, right] });
const div = (
  left: StyleExpression,
  right: StyleExpression,
): StyleExpression => ({ op: "div", args: [left, right] });

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

const NISAR_GCOV_VARIABLES = ["HHHH", "HVHV"];

const NISAR_GCOV_SUBLAYERS: SubLayerSpec[] = [
  {
    params: { group: "/science/LSAR/GCOV/grids/frequencyB" },
    minzoom: 6,
    maxzoom: 10,
  },
  {
    params: { group: "/science/LSAR/GCOV/grids/frequencyA" },
    minzoom: 10,
  },
];

const NISAR_GCOV_COMMON_PARAMS = {
  sortkey: "-start_date",
  skipcovered: "true",
  exitwhenfull: "true",
};

const withRescale = (
  expression: StyleExpression,
  rescale?: [number, number],
): StyleExpressionRef => ({ expression, rescale });

const NISAR_GCOV_RGB_OPTIONS: RgbExpressionOption[] = [
  {
    label: "HHHH",
    value: "hh",
    compiled: mul(constant(10), log10(band(1))),
    rescale: [-20, 0],
  },
  {
    label: "HVHV",
    value: "hv",
    compiled: mul(constant(10), log10(band(2))),
    rescale: [-30, 5],
  },
  {
    label: "HHHH : HVHV",
    value: "ratio",
    compiled: mul(constant(10), log10(div(band(1), band(2)))),
    rescale: [2, 18],
  },
];

const HLS_NORMALIZED_RANGE: [number, number] = [0, 32767];

const SCALAR_COLORMAP_OPTIONS = [
  { label: "Turbo", value: "turbo" },
  { label: "Viridis", value: "viridis" },
  { label: "Thermal", value: "thermal" },
  { label: "Cividis", value: "cividis" },
  { label: "Spectral", value: "spectral" },
  { label: "Blue", value: "blues_r" },
  { label: "Red–Yellow–Green", value: "rdylgn" },
  { label: "Nipy Spectral", value: "nipy_spectral" },
] as const;

const HLS_TRUE_COLOR_ADJUSTMENTS: ToneAdjustment[] = [
  { kind: "gamma", value: 3.5 },
  { kind: "saturation", value: 1.2 },
  { kind: "sigmoidal", contrast: 15, bias: 0.35 },
];

const HLS_FALSE_COLOR_ADJUSTMENTS: ToneAdjustment[] = [
  { kind: "gamma", value: 2.5 },
  { kind: "saturation", value: 1.2 },
  { kind: "sigmoidal", contrast: 10, bias: 0.35 },
];

export const DATASETS: DatasetConfig[] = [
  {
    id: "hls",
    label: "HLS (Harmonized Landsat Sentinel-2)",
    collection: [
      {
        label: "HLSS30 (Sentinel-2)",
        slug: "hlss30",
        collectionConceptId: "C2021957295-LPCLOUD",
        assetsRegex: "B[0-9][0-9A-Za-z]",
        backend: "rasterio",
        minzoom: 5,
        maxzoom: 13,
        attribution:
          '<a href="https://lpdaac.usgs.gov/products/hlss30v002/" target="_blank">HLS Sentinel-2 (NASA LP DAAC / ESA)</a>',
        date: { mode: "switchable", defaultMode: "month" },
        queryParams: [
          {
            type: "range",
            label: "Cloud Cover (%)",
            key: "cloud_cover",
            min: 0,
            max: 100,
            step: 1,
            default: [0, 100],
          },
          {
            type: "select",
            label: "Sort by",
            key: "sort_key",
            options: [
              { label: "Least cloudy", value: "cloud_cover" },
              { label: "Most recent", value: "-start_date" },
              { label: "Oldest", value: "start_date" },
            ],
            default: "cloud_cover",
          },
        ],
        renders: [
          {
            label: "True Color",
            fetch: {
              assets: ["B04", "B03", "B02"],
              params: { exitwhenfull: "true" },
            },
            style: {
              kind: "rgb",
              channels: [
                withRescale(band(1), HLS_NORMALIZED_RANGE),
                withRescale(band(2), HLS_NORMALIZED_RANGE),
                withRescale(band(3), HLS_NORMALIZED_RANGE),
              ],
              alphaBand: 4,
              adjustments: HLS_TRUE_COLOR_ADJUSTMENTS,
            },
          },
          {
            label: "False Color (NIR)",
            fetch: {
              assets: ["B8A", "B03", "B02"],
              params: { exitwhenfull: "true" },
            },
            style: {
              kind: "rgb",
              channels: [
                withRescale(band(1), HLS_NORMALIZED_RANGE),
                withRescale(band(2), HLS_NORMALIZED_RANGE),
                withRescale(band(3), HLS_NORMALIZED_RANGE),
              ],
              alphaBand: 4,
              adjustments: HLS_FALSE_COLOR_ADJUSTMENTS,
            },
          },
        ],
      },
      {
        label: "HLSL30 (Landsat 8/9)",
        slug: "hlsl30",
        collectionConceptId: "C2021957657-LPCLOUD",
        assetsRegex: "B[0-9][0-9]",
        minzoom: 5,
        maxzoom: 13,
        backend: "rasterio",
        attribution:
          '<a href="https://lpdaac.usgs.gov/products/hlsl30v002/" target="_blank">HLS Landsat (NASA LP DAAC)</a>',
        date: { mode: "switchable", defaultMode: "month" },
        queryParams: [
          {
            type: "range",
            label: "Cloud Cover (%)",
            key: "cloud_cover",
            min: 0,
            max: 100,
            step: 1,
            default: [0, 100],
          },
          {
            type: "select",
            label: "Sort by",
            key: "sort_key",
            options: [
              { label: "Least cloudy", value: "cloud_cover" },
              { label: "Most recent", value: "-start_date" },
              { label: "Oldest", value: "start_date" },
            ],
            default: "cloud_cover",
          },
        ],
        renders: [
          {
            label: "True Color",
            fetch: {
              assets: ["B04", "B03", "B02"],
              params: { exitwhenfull: "true" },
            },
            style: {
              kind: "rgb",
              channels: [
                withRescale(band(1), HLS_NORMALIZED_RANGE),
                withRescale(band(2), HLS_NORMALIZED_RANGE),
                withRescale(band(3), HLS_NORMALIZED_RANGE),
              ],
              alphaBand: 4,
              adjustments: HLS_TRUE_COLOR_ADJUSTMENTS,
            },
          },
          {
            label: "False Color (NIR)",
            fetch: {
              assets: ["B05", "B03", "B02"],
              params: { exitwhenfull: "true" },
            },
            style: {
              kind: "rgb",
              channels: [
                withRescale(band(1), HLS_NORMALIZED_RANGE),
                withRescale(band(2), HLS_NORMALIZED_RANGE),
                withRescale(band(3), HLS_NORMALIZED_RANGE),
              ],
              alphaBand: 4,
              adjustments: HLS_FALSE_COLOR_ADJUSTMENTS,
            },
          },
        ],
      },
    ],
  },
  {
    id: "nisar-gcov",
    label: "NISAR Provisional GCOV",
    collection: {
      label: "NISAR Provisional L2 GCOV",
      collectionConceptId: "C2854338529-ASF",
      backend: "xarray",
      minzoom: 6,
      maxzoom: 13,
      attribution:
        '<a href="https://nisar.jpl.nasa.gov/" target="_blank">NISAR GCOV (NASA JPL / ISRO / ASF DAAC)</a>',
      date: {
        mode: "switchable",
        defaultMode: "range",
        default: ["2026-07-01", "2026-08-01"],
      },
      queryParams: [
        {
          type: "attribute",
          label: "Orbit Direction",
          attributeType: "string",
          attributeName: "ASCENDING_DESCENDING",
          options: [
            { label: "All", value: null },
            { label: "Ascending", value: "ASCENDING" },
            { label: "Descending", value: "DESCENDING" },
          ],
          default: null,
        },
      ],
      renders: [
        {
          label: "Balanced Dual-Pol RGB",
          fetch: {
            variables: NISAR_GCOV_VARIABLES,
            params: NISAR_GCOV_COMMON_PARAMS,
          },
          style: {
            kind: "rgb",
            channels: [
              withRescale(mul(constant(10), log10(band(1))), [-20, 0]),
              withRescale(mul(constant(10), log10(band(2))), [-30, 5]),
              withRescale(
                mul(constant(10), log10(div(band(1), band(2)))),
                [2, 18],
              ),
            ],
          },
          subLayers: NISAR_GCOV_SUBLAYERS,
        },
        {
          label: "Vegetation / Volume Emphasis",
          fetch: {
            variables: NISAR_GCOV_VARIABLES,
            params: NISAR_GCOV_COMMON_PARAMS,
          },
          style: {
            kind: "rgb",
            channels: [
              withRescale(mul(constant(10), log10(band(2))), [-30, 5]),
              withRescale(mul(constant(10), log10(band(1))), [-20, 0]),
              withRescale(
                mul(constant(10), log10(div(band(1), band(2)))),
                [2, 18],
              ),
            ],
          },
          subLayers: NISAR_GCOV_SUBLAYERS,
        },
        {
          label: "Urban / Built Structure Emphasis",
          fetch: {
            variables: NISAR_GCOV_VARIABLES,
            params: NISAR_GCOV_COMMON_PARAMS,
          },
          style: {
            kind: "rgb",
            channels: [
              withRescale(
                mul(constant(10), log10(div(band(1), band(2)))),
                [2, 18],
              ),
              withRescale(mul(constant(10), log10(band(1))), [-20, 0]),
              withRescale(mul(constant(10), log10(band(2))), [-30, 5]),
            ],
          },
          subLayers: NISAR_GCOV_SUBLAYERS,
        },
        {
          label: "Water / Smooth Surface Emphasis",
          fetch: {
            variables: NISAR_GCOV_VARIABLES,
            params: NISAR_GCOV_COMMON_PARAMS,
          },
          style: {
            kind: "rgb",
            channels: [
              withRescale(mul(constant(10), log10(band(2))), [-30, 5]),
              withRescale(
                mul(constant(10), log10(div(band(1), band(2)))),
                [2, 18],
              ),
              withRescale(mul(constant(10), log10(band(1))), [-20, 0]),
            ],
          },
          subLayers: NISAR_GCOV_SUBLAYERS,
        },
        {
          label: "Custom RGB Composite",
          fetch: {
            variables: NISAR_GCOV_VARIABLES,
            params: NISAR_GCOV_COMMON_PARAMS,
          },
          style: {
            kind: "rgb",
            channels: [
              { selectorKey: "rgb_r" },
              { selectorKey: "rgb_g" },
              { selectorKey: "rgb_b" },
            ],
            selectors: [
              {
                key: "rgb_r",
                label: "Red",
                options: NISAR_GCOV_RGB_OPTIONS,
                default: "hh",
              },
              {
                key: "rgb_g",
                label: "Green",
                options: NISAR_GCOV_RGB_OPTIONS,
                default: "hv",
              },
              {
                key: "rgb_b",
                label: "Blue",
                options: NISAR_GCOV_RGB_OPTIONS,
                default: "ratio",
              },
            ],
          },
          subLayers: NISAR_GCOV_SUBLAYERS,
        },
      ],
    },
  },
  {
    id: "mur-sst",
    label: "MUR Sea Surface Temperature",
    collection: {
      label: "MUR SST",
      collectionConceptId: "C1996881146-POCLOUD",
      backend: "xarray",
      minzoom: 0,
      maxzoom: 13,
      attribution:
        '<a href="https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1" target="_blank">MUR SST (NASA JPL PO.DAAC)</a>',
      date: { mode: "single" },
      renders: [
        {
          label: "Sea Surface Temperature",
          fetch: {
            variables: ["analysed_sst"],
          },
          style: {
            kind: "scalar",
            expression: sub(band(1), constant(273.15)),
            rescale: [-2, 29],
            colormapName: "nipy_spectral",
            colormapParamKey: "colormap",
            colormapOptions: [...SCALAR_COLORMAP_OPTIONS],
            nodata: -273.15,
            units: "°C",
          },
        },
        {
          label: "Sea Ice Fraction",
          fetch: {
            variables: ["sea_ice_fraction"],
          },
          style: {
            kind: "scalar",
            expression: mul(constant(100), band(1)),
            rescale: [0, 100],
            colormapName: "blues_r",
            colormapParamKey: "colormap",
            colormapOptions: [...SCALAR_COLORMAP_OPTIONS],
            units: "%",
          },
        },
      ],
    },
  },
  {
    id: "micasa",
    label: "MiCASA Land Carbon Flux",
    collection: {
      label: "MiCASA",
      collectionConceptId: "C3273638632-GES_DISC",
      backend: "xarray",
      minzoom: 0,
      maxzoom: 7,
      attribution:
        '<a href="https://ceos.org/gst/micasa.html" target="_blank">MiCASA (NASA GES DISC)</a>',
      date: { mode: "single", default: "2024-12-31" },
      renders: [
        {
          label: "Net Primary Productivity (NPP)",
          fetch: {
            variables: ["NPP"],
            // MiCASA values are tiny in the raw xarray output; pre-scale on the
            // server so the GPU path does not lose nearly all variation.
            params: {
              expression: "86400000*b1",
            },
          },
          style: {
            kind: "scalar",
            expression: band(1),
            rescale: [-4, 4],
            colormapName: "rdylgn",
            colormapParamKey: "colormap",
            colormapOptions: [...SCALAR_COLORMAP_OPTIONS],
            units: "g C m⁻² day⁻¹",
          },
        },
        {
          label: "Net Biosphere Exchange (NBE)",
          fetch: {
            variables: ["NEE", "FIRE", "FUEL"],
            // Each requested variable is fetched separately, so `b1` refers to
            // the current variable tile and can be pre-scaled independently.
            params: {
              expression: "86400000*b1",
            },
          },
          style: {
            kind: "scalar",
            expression: add(add(band(1), band(2)), band(3)),
            rescale: [-4, 4],
            colormapName: "rdylgn",
            colormapParamKey: "colormap",
            colormapOptions: [...SCALAR_COLORMAP_OPTIONS],
            units: "g C m⁻² day⁻¹",
          },
        },
      ],
    },
  },
];
