import {
  DATASETS,
  type AttributeQueryParam,
  type CollectionConfig,
  type DatasetConfig,
  type DateConfig,
  type QueryParamConfig,
  type RangeQueryParam,
  type RenderConfig,
} from "./config";
import { fetchMetadata, showCollectionDetails } from "./collection-details";

export type ControlState = {
  collection: CollectionConfig;
  render: RenderConfig;
  datetime: string;
  /** Extra per-collection query params. Values may be string[] for repeated
   *  params (e.g. multiple `attribute` filters). */
  extraParams: Record<string, string | string[]>;
};

/**
 * Computes a smart default date value based on mode and the current date.
 * Used when `date.default` is not set on a collection's DateConfig.
 */
function computeDefaultDate(date: DateConfig): string | [string, string] {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  if (date.mode === "month") {
    const d = new Date();
    d.setDate(1); // avoid month-end edge cases when subtracting a month
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (date.mode === "range") {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return [ymd(start), ymd(yesterday)];
  }
  return ymd(yesterday);
}

/** Formats a start/end date pair into an RFC 3339 datetime range string. */
function toDatetimeRange(startDate: string, endDate: string): string {
  return `${startDate}T00:00:00Z/${endDate}T23:59:59Z`;
}

/** Converts a "YYYY-MM" month string into a full-month RFC 3339 datetime range. */
function monthToDatetimeRange(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return toDatetimeRange(`${yearMonth}-01`, end);
}

function makeLabel(text: string, forId: string): HTMLLabelElement {
  const el = document.createElement("label");
  el.textContent = text;
  el.htmlFor = forId;
  return el;
}

function makeSelect(id: string): HTMLSelectElement {
  const el = document.createElement("select");
  el.id = id;
  return el;
}

function makeDateInput(id: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "date";
  el.id = id;
  return el;
}

// ---------------------------------------------------------------------------
// Date controls rendering
// ---------------------------------------------------------------------------

/**
 * Clears `container` and renders one or two date inputs based on `collection.date.mode`.
 * Returns a getter that produces the correct `datetime` query string.
 */
function renderDateControls(
  container: HTMLElement,
  collection: CollectionConfig,
  onChange: () => void
): () => string {
  const today = new Date();
  const todayYMD = today.toISOString().slice(0, 10);
  const todayYM = todayYMD.slice(0, 7);

  container.innerHTML = "";

  let inputs: HTMLInputElement[];

  if (collection.date.mode === "single") {
    const fallback = computeDefaultDate(collection.date) as string;
    const defaultVal = collection.date.default ?? fallback;
    const input = makeDateInput("date-input");
    input.value = defaultVal;
    input.max = todayYMD;
    input.addEventListener("change", onChange);
    container.appendChild(makeLabel("Date", "date-input"));
    container.appendChild(input);
    inputs = [input];
    fetchMetadata(collection.collectionConceptId).then((umm) => {
      const begin = umm?.TemporalExtents?.[0]?.RangeDateTimes?.[0]?.BeginningDateTime;
      if (begin) inputs.forEach((el) => (el.min = begin.slice(0, 10)));
    });
    return () => {
      const d = input.value || defaultVal;
      return `${d}T00:00:00Z/${d}T23:59:59Z`;
    };
  } else if (collection.date.mode === "month") {
    const fallback = computeDefaultDate(collection.date) as string;
    const defaultMonth = collection.date.default ?? fallback;
    const input = document.createElement("input");
    input.type = "month";
    input.id = "month-input";
    input.value = defaultMonth;
    input.max = todayYM;
    input.addEventListener("change", onChange);
    container.appendChild(makeLabel("Month", "month-input"));
    container.appendChild(input);
    inputs = [input];
    fetchMetadata(collection.collectionConceptId).then((umm) => {
      const begin = umm?.TemporalExtents?.[0]?.RangeDateTimes?.[0]?.BeginningDateTime;
      if (begin) inputs.forEach((el) => (el.min = begin.slice(0, 7)));
    });
    return () => monthToDatetimeRange(input.value || defaultMonth);
  } else {
    const fallback = computeDefaultDate(collection.date) as [string, string];
    const [defaultStart, defaultEnd] = collection.date.default ?? fallback;
    const startInput = makeDateInput("start-date-input");
    const endInput = makeDateInput("end-date-input");
    startInput.value = defaultStart;
    endInput.value = defaultEnd;
    startInput.max = todayYMD;
    endInput.max = todayYMD;
    startInput.addEventListener("change", onChange);
    endInput.addEventListener("change", onChange);
    container.appendChild(makeLabel("Start Date", "start-date-input"));
    container.appendChild(startInput);
    container.appendChild(makeLabel("End Date", "end-date-input"));
    container.appendChild(endInput);
    inputs = [startInput, endInput];
    fetchMetadata(collection.collectionConceptId).then((umm) => {
      const begin = umm?.TemporalExtents?.[0]?.RangeDateTimes?.[0]?.BeginningDateTime;
      if (begin) inputs.forEach((el) => (el.min = begin.slice(0, 10)));
    });
    return () => {
      const s = startInput.value || defaultStart;
      const e = endInput.value || defaultEnd;
      return toDatetimeRange(s, e);
    };
  }
}

// ---------------------------------------------------------------------------
// Extra params rendering
// ---------------------------------------------------------------------------

/**
 * Renders a range param as two number inputs.
 * Returns a getter that produces [key, "min,max"].
 */
function renderRangeParam(
  container: HTMLElement,
  param: RangeQueryParam,
  onChange: () => void
): () => [string, string] {
  const wrapper = document.createElement("div");
  wrapper.className = "range-param";

  const labelEl = document.createElement("div");
  labelEl.className = "range-param-label";
  labelEl.textContent = param.label;
  wrapper.appendChild(labelEl);

  const row = document.createElement("div");
  row.className = "range-param-row";

  const makeNum = (val: number, id: string) => {
    const el = document.createElement("input");
    el.type = "number";
    el.id = id;
    el.min = String(param.min);
    el.max = String(param.max);
    el.step = String(param.step ?? 1);
    el.value = String(val);
    el.addEventListener("change", onChange);
    return el;
  };

  const minInput = makeNum(param.default[0], `extra-${param.key}-min`);
  const maxInput = makeNum(param.default[1], `extra-${param.key}-max`);

  const sep = document.createElement("span");
  sep.textContent = "–";
  sep.className = "range-sep";

  row.appendChild(minInput);
  row.appendChild(sep);
  row.appendChild(maxInput);
  wrapper.appendChild(row);
  container.appendChild(wrapper);

  return () => [param.key, `${minInput.value},${maxInput.value}`];
}

/**
 * Renders an attribute filter param as a select or text input.
 * Returns a getter that produces [key, value | null].
 * null means "omit this filter".
 */
function renderAttributeParam(
  container: HTMLElement,
  param: AttributeQueryParam,
  onChange: () => void
): () => [string, string | null] {
  const id = `extra-attr-${param.attributeName}`;
  const serialized = (v: string) =>
    `${param.attributeType},${param.attributeName},${v}`;

  if (param.options) {
    const select = makeSelect(id);
    for (const opt of param.options) {
      const el = document.createElement("option");
      el.value = opt.value ?? "";
      el.textContent = opt.label;
      if (opt.value === param.default) el.selected = true;
      select.appendChild(el);
    }
    select.addEventListener("change", onChange);
    container.appendChild(makeLabel(param.label, id));
    container.appendChild(select);
    return () => {
      const v = select.value;
      return ["attribute", v === "" ? null : serialized(v)];
    };
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.placeholder = "No filter";
    input.value = param.default ?? "";
    input.addEventListener("change", onChange);
    container.appendChild(makeLabel(param.label, id));
    container.appendChild(input);
    return () => {
      const v = input.value.trim();
      return ["attribute", v === "" ? null : serialized(v)];
    };
  }
}

/**
 * Renders all extra query param controls into `container`.
 * Returns a function that collects their current values.
 */
function renderExtraParams(
  container: HTMLElement,
  queryParams: QueryParamConfig[],
  onChange: () => void
): () => Record<string, string | string[]> {
  container.innerHTML = "";
  if (queryParams.length === 0) return () => ({});

  type Getter = () => [string, string | null];
  const getters: Getter[] = [];

  for (const param of queryParams) {
    if (param.type === "range") {
      const g = renderRangeParam(container, param, onChange);
      getters.push(() => g());
    } else if (param.type === "attribute") {
      getters.push(renderAttributeParam(container, param, onChange));
    } else if (param.type === "select") {
      const id = `extra-${param.key}`;
      const select = makeSelect(id);
      for (const opt of param.options) {
        const el = document.createElement("option");
        el.value = opt.value;
        el.textContent = opt.label;
        if (opt.value === param.default) el.selected = true;
        select.appendChild(el);
      }
      select.addEventListener("change", onChange);
      container.appendChild(makeLabel(param.label, id));
      container.appendChild(select);
      getters.push(() => [param.key, select.value]);
    } else {
      // text
      const id = `extra-${param.key}`;
      const input = document.createElement("input");
      input.type = "text";
      input.id = id;
      input.value = param.default;
      input.addEventListener("change", onChange);
      container.appendChild(makeLabel(param.label, id));
      container.appendChild(input);
      getters.push(() => [param.key, input.value]);
    }
  }

  return () => {
    const result: Record<string, string | string[]> = {};
    for (const g of getters) {
      const [key, value] = g();
      if (value === null) continue;
      const existing = result[key];
      if (existing === undefined) {
        result[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    }
    return result;
  };
}

// ---------------------------------------------------------------------------
// Main controls init
// ---------------------------------------------------------------------------

/**
 * Mounts the controls panel and wires up all interactions.
 * Returns a `getState` function for reading current control values.
 */
export function initControls(onChange: (state: ControlState) => void): {
  getState: () => ControlState;
} {
  const container = document.getElementById("controls")!;
  const toggleBtn = document.getElementById("controls-toggle")!;

  // --- Mobile toggle ---
  toggleBtn.addEventListener("click", () => {
    const isOpen = container.classList.toggle("open");
    toggleBtn.textContent = isOpen ? "✕" : "☰";
    toggleBtn.setAttribute("aria-expanded", String(isOpen));
  });

  // --- Header section (dataset / collection / render) ---
  const header = document.createElement("div");
  header.className = "controls-header";

  const datasetSelect = makeSelect("dataset-select");
  const collectionSelect = makeSelect("collection-select");
  const renderSelect = makeSelect("render-select");

  const collectionRow = document.createElement("div");
  collectionRow.appendChild(makeLabel("Collection", "collection-select"));
  collectionRow.appendChild(collectionSelect);

  const infoBtn = document.createElement("button");
  infoBtn.className = "collection-info-btn";
  infoBtn.title = "View collection details";
  infoBtn.textContent = "ⓘ details";

  header.appendChild(makeLabel("Dataset", "dataset-select"));
  header.appendChild(datasetSelect);
  header.appendChild(collectionRow);
  header.appendChild(makeLabel("Render", "render-select"));
  header.appendChild(renderSelect);
  header.appendChild(infoBtn);

  // --- Primary section (dates — populated dynamically) ---
  const primary = document.createElement("div");
  primary.className = "controls-primary";

  // --- Advanced section (extra query params) ---
  const details = document.createElement("details");
  details.className = "controls-advanced";

  const summary = document.createElement("summary");
  summary.textContent = "Advanced";
  details.appendChild(summary);

  const extraParamsContainer = document.createElement("div");
  extraParamsContainer.id = "extra-params";
  details.appendChild(extraParamsContainer);

  container.appendChild(header);
  container.appendChild(primary);
  container.appendChild(details);

  let readDatetime: () => string = () => "";
  let readExtraParams: () => Record<string, string | string[]> = () => ({});

  // --- Dataset/collection/render helpers ---

  function getCollections(dataset: DatasetConfig): CollectionConfig[] {
    return Array.isArray(dataset.collection)
      ? dataset.collection
      : [dataset.collection];
  }

  function populateDatasets(): void {
    datasetSelect.innerHTML = "";
    for (const ds of DATASETS) {
      const opt = document.createElement("option");
      opt.value = ds.id;
      opt.textContent = ds.label;
      datasetSelect.appendChild(opt);
    }
  }

  function getSelectedDataset(): DatasetConfig {
    return DATASETS.find((d) => d.id === datasetSelect.value) ?? DATASETS[0];
  }

  function populateCollections(dataset: DatasetConfig): void {
    collectionSelect.innerHTML = "";
    for (const col of getCollections(dataset)) {
      const opt = document.createElement("option");
      opt.value = col.collectionConceptId;
      opt.textContent = col.label;
      collectionSelect.appendChild(opt);
    }
  }

  function getSelectedCollection(dataset: DatasetConfig): CollectionConfig {
    return (
      getCollections(dataset).find(
        (c) => c.collectionConceptId === collectionSelect.value
      ) ?? getCollections(dataset)[0]
    );
  }

  function populateRenders(collection: CollectionConfig): void {
    renderSelect.innerHTML = "";
    for (let i = 0; i < collection.renders.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = collection.renders[i].label;
      renderSelect.appendChild(opt);
    }
  }

  function getState(): ControlState {
    const dataset = getSelectedDataset();
    const collection = getSelectedCollection(dataset);
    const renderIdx = parseInt(renderSelect.value ?? "0", 10);
    const render = collection.renders[renderIdx] ?? collection.renders[0];
    return { collection, render, datetime: readDatetime(), extraParams: readExtraParams() };
  }

  function onDatasetChange(): void {
    const dataset = getSelectedDataset();
    populateCollections(dataset);
    collectionRow.hidden = getCollections(dataset).length <= 1;
    onCollectionChange();
  }

  function onCollectionChange(): void {
    const collection = getSelectedCollection(getSelectedDataset());
    populateRenders(collection);
    readDatetime = renderDateControls(primary, collection, () => onChange(getState()));
    readExtraParams = renderExtraParams(
      extraParamsContainer,
      collection.queryParams ?? [],
      () => onChange(getState())
    );
    details.open = (collection.queryParams?.length ?? 0) > 0;
    infoBtn.onclick = () => showCollectionDetails(collection);
    onChange(getState());
  }

  datasetSelect.addEventListener("change", onDatasetChange);
  collectionSelect.addEventListener("change", onCollectionChange);
  renderSelect.addEventListener("change", () => onChange(getState()));

  populateDatasets();
  onDatasetChange();

  return { getState };
}
