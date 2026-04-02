export const TITILER_ENDPOINT =
  "https://staging.openveda.cloud/api/titiler-cmr";

/** A single sub-layer within a multi-layer render (e.g. NISAR frequencyA/B). */
export type SubLayerSpec = {
  /** Extra/override params for this sub-layer (e.g. `group` for xarray). */
  params: Record<string, string>;
  minzoom: number;
  maxzoom?: number;
};

export type RenderConfig = {
  label: string;
  /** Asset names for rasterio backend (e.g. ["B04","B03","B02"]). */
  assets?: string[];
  /** Variable names for xarray backend (e.g. ["analysed_sst"]). */
  variables?: string[];
  /** Additional query params merged into TileJSON requests. Values may be
   *  arrays for repeated params (e.g. `rescale: ["-20,0","-30,5","2,18"]`). */
  params: Record<string, string | string[]>;
  /** When present, produces one map layer per entry instead of a single layer. */
  subLayers?: SubLayerSpec[];
};

/**
 * Controls the date picker UI and how the `datetime` query param is formed.
 * - `single`: one date input; datetime sent as a single-day range.
 * - `range`: two date inputs (start / end).
 */
export type DateConfig =
  | { mode: "single"; default: string }
  | { mode: "range"; default: [string, string] };

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
  collectionConceptId: string;
  assetsRegex?: string;
  minzoom: number;
  maxzoom: number;
  backend: "rasterio" | "xarray";
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

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export const DATASETS: DatasetConfig[] = [
  {
    id: "hls",
    label: "HLS (Harmonized Landsat Sentinel-2)",
    collection: [
      {
        label: "HLSL30 (Landsat 8/9)",
        collectionConceptId: "C2021957657-LPCLOUD",
        assetsRegex: "B[0-9][0-9]",
        minzoom: 5,
        maxzoom: 13,
        backend: "rasterio",
        date: { mode: "range", default: ["2025-09-01", "2025-09-30"] },
        queryParams: [
          {
            type: "range",
            label: "Cloud Cover (%)",
            key: "cloud_cover",
            min: 0,
            max: 100,
            step: 1,
            default: [0, 40],
          },
        ],
        renders: [
          {
            label: "True Color",
            assets: ["B04", "B03", "B02"],
            params: {
              color_formula:
                "Gamma RGB 3.5 Saturation 1.2 Sigmoidal RGB 15 0.35",
              sort_key: "cloud_cover",
              exitwhenfull: "true",
            },
          },
          {
            label: "False Color (NIR)",
            assets: ["B05", "B03", "B02"],
            params: {
              color_formula:
                "Gamma RGB 2.5 Saturation 1.2 Sigmoidal RGB 10 0.35",
              sort_key: "cloud_cover",
              exitwhenfull: "true",
            },
          },
        ],
      },
      {
        label: "HLSS30 (Sentinel-2)",
        collectionConceptId: "C2021957295-LPCLOUD",
        assetsRegex: "B[0-9][0-9A-Za-z]",
        backend: "rasterio",
        minzoom: 5,
        maxzoom: 13,
        date: { mode: "range", default: ["2025-09-01", "2025-09-30"] },
        queryParams: [
          {
            type: "range",
            label: "Cloud Cover (%)",
            key: "cloud_cover",
            min: 0,
            max: 100,
            step: 1,
            default: [0, 40],
          },
        ],
        renders: [
          {
            label: "True Color",
            assets: ["B04", "B03", "B02"],
            params: {
              color_formula:
                "Gamma RGB 3.5 Saturation 1.2 Sigmoidal RGB 15 0.35",
              sort_key: "cloud_cover",
              exitwhenfull: "true",
            },
          },
          {
            label: "False Color (NIR)",
            assets: ["B8A", "B03", "B02"],
            params: {
              color_formula:
                "Gamma RGB 2.5 Saturation 1.2 Sigmoidal RGB 10 0.35",
              sort_key: "cloud_cover",
              exitwhenfull: "true",
            },
          },
        ],
      },
    ],
  },
  {
    id: "nisar-gcov",
    label: "NISAR Beta GCOV",
    collection: {
      label: "NISAR L2 GCOV",
      collectionConceptId: "C3622214170-ASF",
      backend: "xarray",
      minzoom: 6,
      maxzoom: 13,
      date: { mode: "range", default: ["2026-01-01", "2026-02-01"] },
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
          label: "HHHH / HVHV RGB",
          variables: ["HHHH", "HVHV"],
          params: {
            expression:
              "10 * log10(b1); 10 * log10(b2); 10 * log10(b1/b2)",
            rescale: ["-20,0", "-30,5", "2,18"],
            sortkey: "-start_date",
            skipcovered: "true",
            exitwhenfull: "true",
          },
          subLayers: [
            {
              params: { group: "/science/LSAR/GCOV/grids/frequencyB" },
              minzoom: 6,
              maxzoom: 10,
            },
            {
              params: { group: "/science/LSAR/GCOV/grids/frequencyA" },
              minzoom: 10,
            },
          ],
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
      maxzoom: 7,
      date: { mode: "single", default: "2024-01-15" },
      renders: [
        {
          label: "Sea Surface Temperature",
          variables: ["analysed_sst"],
          params: {
            colormap_name: "nipy_spectral",
            rescale: "271,302",
          },
        },
        {
          label: "Sea Ice Fraction",
          variables: ["sea_ice_fraction"],
          params: {
            colormap_name: "blues_r",
            rescale: "0,1",
          },
        },
      ],
    },
  },
];
