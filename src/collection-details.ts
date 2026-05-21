import type { CollectionConfig } from "./config";

const CMR_SEARCH = "https://cmr.earthdata.nasa.gov/search";

type CmrRangeDateTime = {
  BeginningDateTime?: string;
  EndingDateTime?: string;
  EndsAtPresentFlag?: boolean;
};

type CmrUmm = {
  Abstract?: string;
  TemporalExtents?: Array<{ RangeDateTimes?: CmrRangeDateTime[] }>;
  DOI?: { DOI: string };
  RelatedUrls?: Array<{ Type: string; URL: string }>;
};

const cache = new Map<string, Promise<CmrUmm | null>>();

export function fetchMetadata(conceptId: string): Promise<CmrUmm | null> {
  if (!cache.has(conceptId)) {
    cache.set(
      conceptId,
      fetch(
        `${CMR_SEARCH}/collections.umm_json?concept_id=${encodeURIComponent(conceptId)}`
      )
        .then((r) => r.json())
        .then((data) => (data.items?.[0]?.umm as CmrUmm) ?? null)
        .catch(() => null)
    );
  }
  return cache.get(conceptId)!;
}

/** Formats an ISO datetime string as a short date (YYYY-MM-DD). */
function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Builds the metadata section DOM from a fetched UMM record. */
function renderMetadata(body: HTMLElement, umm: CmrUmm, conceptId: string): void {
  body.innerHTML = "";

  if (umm.Abstract) {
    const abstract = document.createElement("p");
    abstract.className = "collection-details-abstract";
    abstract.textContent = umm.Abstract;
    body.appendChild(abstract);
  }

  const dl = document.createElement("dl");
  dl.className = "collection-details-meta";

  function addRow(label: string, content: string | HTMLElement): void {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (typeof content === "string") {
      dd.textContent = content;
    } else {
      dd.appendChild(content);
    }
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  // Temporal coverage
  const rangeDateTime =
    umm.TemporalExtents?.[0]?.RangeDateTimes?.[0];
  if (rangeDateTime) {
    const start = rangeDateTime.BeginningDateTime
      ? shortDate(rangeDateTime.BeginningDateTime)
      : "unknown";
    const end = rangeDateTime.EndsAtPresentFlag
      ? "present"
      : rangeDateTime.EndingDateTime
        ? shortDate(rangeDateTime.EndingDateTime)
        : "present";
    addRow("Temporal", `${start} – ${end}`);
  }

  // Concept ID with Earthdata Search link
  const conceptLink = document.createElement("a");
  conceptLink.href = `https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(conceptId)}`;
  conceptLink.target = "_blank";
  conceptLink.rel = "noopener";
  conceptLink.textContent = conceptId;
  addRow("Concept ID", conceptLink);

  // DOI
  if (umm.DOI?.DOI) {
    const doiLink = document.createElement("a");
    doiLink.href = `https://doi.org/${umm.DOI.DOI}`;
    doiLink.target = "_blank";
    doiLink.rel = "noopener";
    doiLink.textContent = umm.DOI.DOI;
    addRow("DOI", doiLink);
  }

  // Dataset landing page from RelatedUrls
  const landingUrl = umm.RelatedUrls?.find(
    (u) => u.Type === "DATA SET LANDING PAGE"
  )?.URL;
  if (landingUrl) {
    const landingLink = document.createElement("a");
    landingLink.href = landingUrl;
    landingLink.target = "_blank";
    landingLink.rel = "noopener";
    landingLink.textContent = "Dataset landing page";
    addRow("More info", landingLink);
  }

  body.appendChild(dl);
}

/**
 * Opens the collection details modal for the given collection, fetching CMR
 * metadata on demand and caching it for subsequent views.
 */
export function showCollectionDetails(collection: CollectionConfig): void {
  const modal = document.getElementById("collection-details-modal")!;
  const backdrop = document.getElementById("collection-details-backdrop")!;
  const title = document.getElementById("collection-details-title")!;
  const body = modal.querySelector<HTMLElement>(".collection-details-body")!;

  title.textContent = collection.label;

  // Show spinner while fetching
  body.innerHTML = `<div class="collection-details-loading"><div class="spinner"></div></div>`;

  modal.classList.add("visible");
  backdrop.classList.add("visible");

  fetchMetadata(collection.collectionConceptId).then((umm) => {
    // Ensure the modal is still showing this collection (user may have closed it)
    if (!modal.classList.contains("visible")) return;

    if (umm) {
      renderMetadata(body, umm, collection.collectionConceptId);
    } else {
      body.innerHTML =
        '<p class="collection-details-error">Could not load collection metadata.</p>';
    }
  });
}

/**
 * Wires up the collection details modal close interactions.
 * Call once during app initialization.
 */
export function initCollectionDetails(): void {
  const modal = document.getElementById("collection-details-modal")!;
  const backdrop = document.getElementById("collection-details-backdrop")!;
  const closeBtn = document.getElementById("collection-details-close")!;

  function close(): void {
    modal.classList.remove("visible");
    backdrop.classList.remove("visible");
  }

  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", close);
  modal
    .querySelector(".about-panel")!
    .addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("visible")) close();
  });
}
