const DIMENSION_ORDER = ["race", "sex", "age", "nativity", "disability"];
const STATUS_PRIORITY = { usable: 4, suppressed: 3, unavailable: 2, incomplete: 1 };
const MAP_COLORS = ["#f4e2c5", "#e4bc84", "#d47d61", "#b6404a", "#7e2030"];
const ROW_STATUS_LABELS = {
  usable: "Available",
  suppressed: "Suppressed",
  unavailable: "Unavailable",
  incomplete: "Incomplete",
};
const RAW_SUPPORT_STATUS_LABELS = {
  supported: "Supported",
  supported_with_suppression: "Supported with suppressed counties",
  unsupported: "Unsupported",
  incomplete: "Incomplete",
};
const RAW_SUPPORTED_STATUSES = new Set(["supported", "supported_with_suppression"]);

const state = {
  data: null,
  rowsByIndicatorSubgroup: new Map(),
  supportByIndicatorDimension: new Map(),
  countyRowsByIndicatorSubgroup: new Map(),
  countyNameByFips: new Map(),
  indicatorMetaByKey: new Map(),
  dimensionLabelByKey: new Map(),
  featurePaths: [],
  mapFocusOrder: [],
  mapHasRows: false,
  hoveredCounty: null,
  focusedCounty: null,
  rovingCounty: null,
  selectedDomain: null,
  selectedIndicator: null,
  selectedDimensions: [],
  selectedSubgroup: null,
  selectedCounty: null,
};

function keyFor(...parts) {
  return parts.join("::");
}

function dimensionSetKey(dimensions) {
  const ordered = DIMENSION_ORDER.filter((dimension) => dimensions.includes(dimension));
  return ordered.length ? ordered.join("+") : "overall";
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hasText(value) {
  return value !== null && value !== undefined && String(value) !== "";
}

function getRowStatusLabel(status) {
  return ROW_STATUS_LABELS[status] || "Unknown";
}

function getSupportStatusLabel(status) {
  return RAW_SUPPORT_STATUS_LABELS[status] || "Unknown";
}

function humanizeDimensionSet(value) {
  if (!value || value === "overall") {
    return "Overall";
  }
  return value
    .split("+")
    .map((item) => state.dimensionLabelByKey.get(item) || item.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()))
    .join(" + ");
}

function formatValue(row) {
  if (!row) {
    return "--";
  }
  if (row.data_status === "suppressed") {
    return "Suppressed";
  }
  if (row.data_status === "unavailable") {
    return "Unavailable";
  }
  if (row.data_status === "incomplete") {
    return "Incomplete";
  }
  if (hasText(row.rate_pct)) {
    return `${row.rate_pct}%`;
  }
  return "--";
}

function isNumericStatus(status) {
  return status === "usable" || status === "suppressed";
}

function buildIndexes(data) {
  data.metadata.indicators.forEach((indicator) => {
    state.indicatorMetaByKey.set(indicator.indicator_key, indicator);
  });
  data.metadata.dimension_options.forEach((dimension) => {
    state.dimensionLabelByKey.set(dimension.dimension_key, dimension.dimension_label);
  });
  data.geojson.features.forEach((feature) => {
    state.countyNameByFips.set(feature.id, feature.properties.county_name);
  });
  data.canonical.forEach((row) => {
    const subgroupKey = keyFor(row.indicator_key, row.subgroup_key);
    const countyKey = keyFor(row.indicator_key, row.subgroup_key, row.county_fips);
    if (!state.rowsByIndicatorSubgroup.has(subgroupKey)) {
      state.rowsByIndicatorSubgroup.set(subgroupKey, []);
    }
    state.rowsByIndicatorSubgroup.get(subgroupKey).push(row);
    state.countyRowsByIndicatorSubgroup.set(countyKey, row);
  });

  data.support_matrix.forEach((row) => {
    const supportKey = keyFor(row.indicator_key, row.selected_dimension_set);
    if (!state.supportByIndicatorDimension.has(supportKey)) {
      state.supportByIndicatorDimension.set(supportKey, []);
    }
    state.supportByIndicatorDimension.get(supportKey).push(row);
  });
}

function setupRevealAnimations() {
  const items = Array.from(document.querySelectorAll(".reveal"));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }
  document.body.classList.add("has-reveal-motion");
  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    },
    { threshold: 0, rootMargin: "0px 0px -40px 0px" }
  );
  items.forEach((item) => observer.observe(item));
}

function setupFaqAnimations() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll(".faq-item").forEach((item) => {
    const summary = item.querySelector("summary");
    const content = item.querySelector(".faq-answer");
    const inner = item.querySelector(".faq-answer-inner");
    if (!summary || !content || !inner) {
      return;
    }

    const setClosed = () => {
      content.style.height = "0px";
      content.style.opacity = "0";
    };

    const setOpen = () => {
      item.open = true;
      content.style.height = "auto";
      content.style.opacity = "1";
    };

    if (item.open) {
      setOpen();
    } else {
      setClosed();
    }

    summary.addEventListener("click", (event) => {
      event.preventDefault();
      if (reduceMotion) {
        if (item.open) {
          item.open = false;
          setClosed();
        } else {
          setOpen();
        }
        return;
      }

      if (item.open) {
        content.style.height = `${inner.getBoundingClientRect().height}px`;
        content.style.opacity = "1";
        requestAnimationFrame(() => {
          content.style.height = "0px";
          content.style.opacity = "0";
        });
        const onClose = (transitionEvent) => {
          if (transitionEvent.propertyName !== "height") {
            return;
          }
          item.open = false;
          content.removeEventListener("transitionend", onClose);
        };
        content.addEventListener("transitionend", onClose);
        return;
      }

      item.open = true;
      content.style.height = "0px";
      content.style.opacity = "0";
      requestAnimationFrame(() => {
        content.style.height = `${inner.getBoundingClientRect().height}px`;
        content.style.opacity = "1";
      });
      const onOpen = (transitionEvent) => {
        if (transitionEvent.propertyName !== "height") {
          return;
        }
        content.style.height = "auto";
        content.removeEventListener("transitionend", onOpen);
      };
      content.addEventListener("transitionend", onOpen);
    });
  });
}

function setMetric(name, value) {
  const node = document.querySelector(`[data-metric="${name}"]`);
  if (node) {
    node.textContent = String(value);
  }
}

function injectRuntimeMetadata() {
  const yearNode = document.querySelector("[data-current-year]");
  if (yearNode) {
    yearNode.textContent = String(new Date().getFullYear());
  }
}

function getIndicatorsForDomain(domainKey) {
  return state.data.metadata.indicators.filter((indicator) => indicator.domain_key === domainKey);
}

function toCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getCurrentIndicatorMeta() {
  return state.indicatorMetaByKey.get(state.selectedIndicator) || null;
}

function getCurrentSupportRows() {
  const supportKey = keyFor(state.selectedIndicator, dimensionSetKey(state.selectedDimensions));
  return (state.supportByIndicatorDimension.get(supportKey) || [])
    .slice()
    .sort((a, b) => a.subgroup_label.localeCompare(b.subgroup_label));
}

function getDashboardEligibleSupportRows() {
  return getCurrentSupportRows().filter((row) => row.subgroup_key && RAW_SUPPORTED_STATUSES.has(row.raw_support_status));
}

function getRepresentativeSupportRow(rows) {
  if (!rows.length) {
    return null;
  }
  return rows
    .slice()
    .sort((left, right) => {
      const usableDifference = toCount(right.usable_county_count) - toCount(left.usable_county_count);
      if (usableDifference !== 0) {
        return usableDifference;
      }
      return left.subgroup_label.localeCompare(right.subgroup_label);
    })[0];
}

function getCurrentSupportContext() {
  const rawRows = getCurrentSupportRows();
  const supportedRows = rawRows.filter((row) => row.subgroup_key && RAW_SUPPORTED_STATUSES.has(row.raw_support_status));
  const selectedSupported =
    state.selectedSubgroup
      ? supportedRows.find((row) => row.subgroup_key === state.selectedSubgroup) || null
      : null;
  const selectedRaw =
    state.selectedSubgroup
      ? rawRows.find((row) => row.subgroup_key === state.selectedSubgroup) || null
      : null;
  const representativeRaw = getRepresentativeSupportRow(rawRows);
  return {
    rawRows,
    supportedRows,
    selectedSupported,
    selectedRaw,
    support: selectedSupported || selectedRaw || representativeRaw || null,
    isDimensionWithheld: !supportedRows.length && rawRows.length > 0,
  };
}

function getCurrentRows() {
  if (!state.selectedIndicator || !state.selectedSubgroup) {
    return [];
  }
  return state.rowsByIndicatorSubgroup.get(keyFor(state.selectedIndicator, state.selectedSubgroup)) || [];
}

function getCurrentSupportRow() {
  return getCurrentSupportContext().support;
}

function resetIndicatorIfNeeded() {
  const indicators = getIndicatorsForDomain(state.selectedDomain);
  if (!indicators.length) {
    state.selectedIndicator = null;
    return;
  }
  if (!indicators.some((indicator) => indicator.indicator_key === state.selectedIndicator)) {
    state.selectedIndicator = indicators[0].indicator_key;
  }
}

function isHealthOutcome() {
  return getCurrentIndicatorMeta()?.domain_key === "health_outcomes";
}

function resetSubgroupIfNeeded() {
  if (isHealthOutcome()) state.selectedDimensions = [];
  const selectable = getDashboardEligibleSupportRows();
  if (!selectable.length) {
    state.selectedSubgroup = null;
    return;
  }
  if (!selectable.some((row) => row.subgroup_key === state.selectedSubgroup)) {
    state.selectedSubgroup = selectable[0].subgroup_key;
  }
}

function resetCountyIfNeeded() {
  const rows = getCurrentRows();
  if (!rows.length) {
    state.selectedCounty = null;
    return;
  }
  if (state.selectedCounty && rows.some((row) => row.county_fips === state.selectedCounty)) {
    return;
  }
  state.selectedCounty = null;
}

function renderDomainPills() {
  const container = document.getElementById("domain-pills");
  const focusedDomain = container.contains(document.activeElement) ? document.activeElement.dataset.domain : null;
  let focusedButton = null;
  container.innerHTML = "";
  state.data.metadata.domains.forEach((domain) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.domain = domain.domain_key;
    button.className = `pill ${domain.domain_key === state.selectedDomain ? "is-active" : ""}`;
    button.setAttribute("aria-pressed", domain.domain_key === state.selectedDomain ? "true" : "false");
    button.textContent = domain.domain_label;
    button.addEventListener("click", () => {
      state.selectedDomain = domain.domain_key;
      resetIndicatorIfNeeded();
      resetSubgroupIfNeeded();
      resetCountyIfNeeded();
      render();
    });
    container.appendChild(button);
    if (domain.domain_key === focusedDomain) focusedButton = button;
    if (domain.domain_key === "health_outcomes" && domain.domain_key === state.selectedDomain) {
      const link = document.createElement("a");
      link.className = "health-outcomes-link";
      link.href = "./insights/health-outcomes.html";
      link.textContent = "Explore how community conditions and health outcomes relate";
      container.appendChild(link);
    }
  });
  focusedButton?.focus({ preventScroll: true });
}

function renderIndicatorSelect() {
  const select = document.getElementById("indicator-select");
  const indicators = getIndicatorsForDomain(state.selectedDomain);
  select.innerHTML = "";
  indicators.forEach((indicator) => {
    const option = document.createElement("option");
    option.value = indicator.indicator_key;
    option.textContent = indicator.indicator_label;
    option.selected = indicator.indicator_key === state.selectedIndicator;
    select.appendChild(option);
  });
  select.onchange = () => {
    state.selectedIndicator = select.value;
    resetSubgroupIfNeeded();
    resetCountyIfNeeded();
    render();
  };
}

function renderDimensionPills() {
  const container = document.getElementById("dimension-pills");
  container.innerHTML = "";
  state.data.metadata.dimension_options.forEach((dimension) => {
    const selected = state.selectedDimensions.includes(dimension.dimension_key);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pill ${selected ? "is-selected" : ""}`;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.textContent = dimension.dimension_label;
    button.disabled = isHealthOutcome();
    button.title = isHealthOutcome() ? "PLACES does not publish demographic breakdowns." : "";
    button.addEventListener("click", () => {
      if (selected) {
        state.selectedDimensions = state.selectedDimensions.filter((value) => value !== dimension.dimension_key);
      } else {
        state.selectedDimensions = DIMENSION_ORDER.filter((value) =>
          [...state.selectedDimensions, dimension.dimension_key].includes(value)
        );
      }
      resetSubgroupIfNeeded();
      resetCountyIfNeeded();
      render();
    });
    container.appendChild(button);
  });
}

function renderSubgroupSelect() {
  const select = document.getElementById("subgroup-select");
  const selectable = getDashboardEligibleSupportRows();
  select.innerHTML = "";
  if (!selectable.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No supported subgroup";
    select.appendChild(option);
    select.disabled = true;
    state.selectedSubgroup = null;
    return;
  }
  selectable.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.subgroup_key;
    option.textContent = row.subgroup_label;
    option.selected = row.subgroup_key === state.selectedSubgroup;
    select.appendChild(option);
  });
  select.disabled = false;
  select.onchange = () => {
    state.selectedSubgroup = select.value;
    resetCountyIfNeeded();
    render();
  };
}

function getSupportTone(row) {
  if (!row) {
    return "default";
  }
  if (row.raw_support_status === "unsupported") {
    return "danger";
  }
  if (row.raw_support_status === "incomplete") {
    return "warning";
  }
  return "default";
}

function incompleteMessage(support) {
  const supportRow = support || getCurrentSupportRow();
  if (state.selectedIndicator === "overcrowding_rate") {
    return "Housing is incomplete here because the partner extract omits B25014_007E and B25014_013E, so overcrowding cannot be closed objectively.";
  }
  if (state.selectedIndicator === "rent_burden_rate") {
    return "Housing is incomplete here because the partner extract omits B25070_011E, so rent burden cannot be closed objectively.";
  }
  if (supportRow?.dashboard_eligibility_note) {
    return supportRow.dashboard_eligibility_note;
  }
  return "This subgroup exists in the partner extract, but the source columns are insufficient to publish an objective county rate.";
}

function renderStatusBand() {
  const node = document.getElementById("status-band");
  const context = getCurrentSupportContext();
  const support = context.support;
  const dimensionLabel = humanizeDimensionSet(dimensionSetKey(state.selectedDimensions));
  node.classList.remove("is-hidden");
  node.dataset.tone = getSupportTone(support);
  if (isHealthOutcome()) {
    node.textContent = "All adults aged 18+. CDC PLACES provides modeled county estimates without demographic breakdowns. Map values are age-adjusted prevalence (%).";
    return;
  }
  if (!support) {
    node.textContent = "Loading support information...";
    return;
  }
  if (RAW_SUPPORTED_STATUSES.has(support.raw_support_status)) {
    node.textContent = "";
    node.classList.add("is-hidden");
    return;
  }
  if (!context.rawRows.length) {
    node.textContent = `The current indicator does not support the selected dimension set (${dimensionLabel}) under the ACS input tables.`;
    return;
  }
  if (support.raw_support_status === "incomplete") {
    node.textContent = incompleteMessage(support);
    return;
  }
  node.textContent = support.dashboard_eligibility_note || `The current indicator does not support the selected dimension set (${dimensionLabel}) under the ACS input tables.`;
}

function getRateExtents(rows) {
  const numeric = rows
    .filter((row) => isNumericStatus(row.data_status))
    .map((row) => toNumber(row.rate))
    .filter((value) => value !== null);
  if (!numeric.length) {
    return null;
  }
  return { min: Math.min(...numeric), max: Math.max(...numeric) };
}

function colorForRate(rate, extents) {
  if (!extents) {
    return "#dfe3df";
  }
  const { min, max } = extents;
  if (Math.abs(max - min) < 1e-9) {
    return MAP_COLORS[Math.floor(MAP_COLORS.length / 2)];
  }
  const normalized = (rate - min) / (max - min);
  const index = Math.max(0, Math.min(MAP_COLORS.length - 1, Math.floor(normalized * MAP_COLORS.length)));
  return MAP_COLORS[index];
}

function extractCoordinates(geometry) {
  const points = [];
  const walk = (value) => {
    if (!Array.isArray(value)) {
      return;
    }
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      points.push(value);
      return;
    }
    value.forEach(walk);
  };
  walk(geometry.coordinates);
  return points;
}

function projectPointFactory(features, width, height, padding) {
  const points = features.flatMap((feature) => extractCoordinates(feature.geometry));
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const scaleX = (width - padding * 2) / (maxLon - minLon);
  const scaleY = (height - padding * 2) / (maxLat - minLat);
  const scale = Math.min(scaleX, scaleY);
  const usedWidth = (maxLon - minLon) * scale;
  const usedHeight = (maxLat - minLat) * scale;
  const offsetX = (width - usedWidth) / 2;
  const offsetY = (height - usedHeight) / 2;

  return ([lon, lat]) => {
    const x = offsetX + (lon - minLon) * scale;
    const y = height - (offsetY + (lat - minLat) * scale);
    return [x, y];
  };
}

function geometryToPath(geometry, projectPoint) {
  const rings = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return rings
    .map((polygon) =>
      polygon
        .map((ring) =>
          ring
            .map((point, index) => {
              const [x, y] = projectPoint(point);
              return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ") + " Z"
        )
        .join(" ")
    )
    .join(" ");
}

function clearCountySelection() {
  state.selectedCounty = null;
  renderDetailPanel();
  renderMap();
  renderRanking();
}

function setMapTabStop(countyFips) {
  state.rovingCounty = countyFips;
  state.featurePaths.forEach(({ feature, path }) => {
    path.setAttribute("tabindex", state.mapHasRows && feature.id === countyFips ? "0" : "-1");
  });
}

function renderMapHighlights() {
  const layer = document.getElementById("map-highlight-layer");
  layer.replaceChildren();
  if (!state.mapHasRows) return;

  const focused = state.featurePaths.find(({ feature }) => feature.id === state.focusedCounty);
  if (focused && !focused.path.matches(":focus-visible")) state.focusedCounty = null;
  const hoveredFips = state.hoveredCounty || state.focusedCounty;

  const addOverlay = (countyFips, hovered) => {
    const entry = state.featurePaths.find(({ feature }) => feature.id === countyFips);
    if (!entry) return;
    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "path");
    overlay.setAttribute("d", entry.path.getAttribute("d"));
    overlay.setAttribute("fill", countyFips === state.selectedCounty ? "var(--county-selected-fill)" : entry.dataFill);
    overlay.setAttribute("class", `county-map-overlay${hovered ? " is-hovered" : ""}`);
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("focusable", "false");
    overlay.setAttribute("pointer-events", "none");
    overlay.dataset.fips = countyFips;
    if (hovered) {
      const [x, y] = entry.center;
      overlay.setAttribute("transform", `translate(${x} ${y}) scale(1.06) translate(${-x} ${-y})`);
    }
    layer.appendChild(overlay);
  };

  if (state.selectedCounty && state.selectedCounty !== hoveredFips) addOverlay(state.selectedCounty, false);
  if (hoveredFips) addOverlay(hoveredFips, true);
}

function selectCountyFromMap(countyFips) {
  state.selectedCounty = countyFips;
  setMapTabStop(countyFips);
  renderDetailPanel();
  renderRanking();
  renderMap();
}

function handleCountyMapKeydown(event, countyFips) {
  if (!state.mapHasRows) return;
  const order = state.mapFocusOrder;
  const currentIndex = order.findIndex(({ feature }) => feature.id === countyFips);
  let nextIndex = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % order.length;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + order.length) % order.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = order.length - 1;
  if (nextIndex !== null) {
    event.preventDefault();
    const next = order[nextIndex];
    setMapTabStop(next.feature.id);
    next.path.focus({ preventScroll: true });
    state.focusedCounty = next.path.matches(":focus-visible") ? next.feature.id : null;
    renderMapHighlights();
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    state.focusedCounty = countyFips;
    selectCountyFromMap(countyFips);
  } else if (event.key === "Escape") {
    event.preventDefault();
    clearCountySelection();
  }
}

function initializeMap() {
  const svg = document.getElementById("county-map");
  const layer = document.getElementById("map-layer");
  const features = state.data.geojson.features;
  const projectPoint = projectPointFactory(features, 960, 620, 28);

  const clearSurface = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  clearSurface.setAttribute("x", "0");
  clearSurface.setAttribute("y", "0");
  clearSurface.setAttribute("width", "960");
  clearSurface.setAttribute("height", "620");
  clearSurface.classList.add("map-clear-surface");
  clearSurface.addEventListener("click", clearCountySelection);
  svg.insertBefore(clearSurface, layer);

  state.featurePaths = features.map((feature) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", geometryToPath(feature.geometry, projectPoint));
    path.setAttribute("role", "button");
    path.setAttribute("tabindex", "-1");
    path.setAttribute("aria-pressed", "false");
    path.dataset.fips = feature.id;
    path.classList.add("county-path");
    path.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      state.hoveredCounty = state.mapHasRows ? feature.id : null;
      renderMapHighlights();
    });
    path.addEventListener("pointerleave", () => {
      if (state.hoveredCounty === feature.id) state.hoveredCounty = null;
      renderMapHighlights();
    });
    path.addEventListener("focus", () => {
      setMapTabStop(feature.id);
      state.focusedCounty = path.matches(":focus-visible") ? feature.id : null;
      renderMapHighlights();
    });
    path.addEventListener("blur", () => {
      if (state.focusedCounty === feature.id) state.focusedCounty = null;
      renderMapHighlights();
    });
    path.addEventListener("keydown", (event) => handleCountyMapKeydown(event, feature.id));
    path.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.mapHasRows) return;
      state.focusedCounty = path.matches(":focus-visible") ? feature.id : null;
      selectCountyFromMap(feature.id);
    });
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    path.appendChild(title);
    layer.appendChild(path);
    const points = extractCoordinates(feature.geometry).map(projectPoint);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    return { feature, path, title, center, dataFill: "#dfe3df" };
  });
  state.mapFocusOrder = state.featurePaths.slice().sort((left, right) =>
    left.feature.properties.county_name.localeCompare(right.feature.properties.county_name)
  );
  state.rovingCounty = state.mapFocusOrder[0]?.feature.id || null;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !state.selectedCounty) return;
    if (event.target?.closest?.('select, input, textarea, [contenteditable="true"], [role="combobox"]')) return;
    event.preventDefault();
    clearCountySelection();
  });
}

function renderLegend(rows) {
  const node = document.getElementById("legend-scale");
  node.innerHTML = "";
  const extents = getRateExtents(rows);
  if (!extents) {
    node.textContent = "No numeric county rates available for the current selection.";
    return;
  }
  const { min, max } = extents;
  for (let index = 0; index < MAP_COLORS.length; index += 1) {
    const fractionStart = index / MAP_COLORS.length;
    const fractionEnd = (index + 1) / MAP_COLORS.length;
    const labelStart = min + (max - min) * fractionStart;
    const labelEnd = min + (max - min) * fractionEnd;
    const wrapper = document.createElement("span");
    wrapper.className = "legend-bin";
    wrapper.innerHTML = `<i class="legend-swatch" style="background:${MAP_COLORS[index]}"></i>${(labelStart * 100).toFixed(1)}-${(labelEnd * 100).toFixed(1)}%`;
    node.appendChild(wrapper);
  }
}

function renderMap() {
  const context = getCurrentSupportContext();
  const rows = getCurrentRows();
  state.mapHasRows = rows.length > 0;
  if (!state.mapHasRows) {
    state.hoveredCounty = null;
    state.focusedCounty = null;
  }
  const rowByCounty = new Map(rows.map((row) => [row.county_fips, row]));
  const extents = getRateExtents(rows);
  state.featurePaths.forEach((entry) => {
    const { feature, path, title } = entry;
    path.style.fill = "";
    const row = rowByCounty.get(feature.id);
    path.className.baseVal = "county-path";
    if (state.selectedCounty === feature.id) {
      path.classList.add("is-selected");
    }
    path.setAttribute("aria-pressed", state.selectedCounty === feature.id ? "true" : "false");
    path.setAttribute("aria-disabled", state.mapHasRows ? "false" : "true");
    if (!rows.length || !row) {
      path.classList.add("is-unavailable");
      path.style.fill = "#dfe3df";
      title.textContent = rows.length
        ? `${feature.properties.county_name}: no row`
        : `${feature.properties.county_name}: no supported county row for this view`;
      entry.dataFill = path.style.fill;
      path.setAttribute("aria-label", title.textContent);
      return;
    }
    if (row.data_status === "suppressed") {
      path.classList.add("is-suppressed");
      path.style.fill = "url(#suppressedPattern)";
    } else if (row.data_status === "usable") {
      path.style.fill = colorForRate(Number(row.rate), extents);
    } else {
      path.classList.add(row.data_status === "incomplete" ? "is-incomplete" : "is-unavailable");
      path.style.fill = "#dfe3df";
    }
    title.textContent = `${state.countyNameByFips.get(row.county_fips)}: ${formatValue(row)} (${getRowStatusLabel(row.data_status)})`;
    entry.dataFill = path.style.fill;
    path.setAttribute("aria-label", title.textContent);
  });
  setMapTabStop(state.rovingCounty);
  renderMapHighlights();

  const mapEmpty = document.getElementById("map-empty");
  if (!rows.length) {
    if (!context.support) {
      mapEmpty.textContent = "No county rows are available for the current selection.";
    } else if (context.support.raw_support_status === "incomplete") {
      mapEmpty.textContent = incompleteMessage(context.support);
    } else if (context.rawRows.length) {
      mapEmpty.textContent =
        context.support.dashboard_eligibility_note ||
        "The ACS input tables do not provide a supported county subgroup for this dimension set.";
    } else {
      mapEmpty.textContent = "The ACS input tables do not support a county map for this dimension set.";
    }
    mapEmpty.classList.remove("is-hidden");
  } else {
    mapEmpty.classList.add("is-hidden");
  }
  renderLegend(rows);
}

function detailTag(label) {
  return `<span class="detail-tag">${label}</span>`;
}

function countStatuses(rows) {
  const counts = { usable: 0, suppressed: 0, unavailable: 0, incomplete: 0 };
  rows.forEach((row) => {
    if (Object.hasOwn(counts, row.data_status)) {
      counts[row.data_status] += 1;
    }
  });
  return counts;
}

function getCurrentIndicatorLabel() {
  return state.indicatorMetaByKey.get(state.selectedIndicator)?.indicator_label || "--";
}

function getCurrentSourceLabel(rows, row, support) {
  if (row?.source_display_label) {
    return row.source_display_label;
  }
  if (support?.source_display_label) {
    return support.source_display_label;
  }
  if (row?.source_table_id) {
    return `ACS Table ${row.source_table_id}`;
  }
  if (support?.source_table_ids) {
    return support.source_table_ids.includes(",") ? `ACS Tables ${support.source_table_ids}` : `ACS Table ${support.source_table_ids}`;
  }
  if (getCurrentIndicatorMeta()?.source_display_label) {
    return getCurrentIndicatorMeta().source_display_label;
  }
  if (getCurrentIndicatorMeta()?.source_table_ids) {
    const sourceIds = getCurrentIndicatorMeta().source_table_ids.join(", ");
    return sourceIds.includes(",") ? `ACS Tables ${sourceIds}` : `ACS Table ${sourceIds}`;
  }
  const sources = [...new Set(rows.map((item) => item.source_table_id).filter(Boolean))];
  if (!sources.length) {
    return "--";
  }
  return sources.length > 1 ? `ACS Tables ${sources.join(", ")}` : `ACS Table ${sources[0]}`;
}

function getNumericRows(rows) {
  return rows
    .filter((row) => isNumericStatus(row.data_status) && toNumber(row.rate) !== null)
    .slice()
    .sort((left, right) => (toNumber(left.rate) || 0) - (toNumber(right.rate) || 0));
}

function buildCountyNote(row) {
  if (!row) {
    return "No county row is available for the current selection.";
  }
  if (row.data_status === "suppressed") {
    return "Suppressed means this county estimate exists in the partner extract but is flagged for caution. It is not the same as a measured 0%.";
  }
  if (row.data_status === "unavailable") {
    return "Unavailable means this county does not have a valid denominator for the current subgroup, so the rate is undefined.";
  }
  if (row.data_status === "incomplete") {
    return "Incomplete means the partner extract does not preserve the source columns needed to close this county rate objectively.";
  }
  if (toNumber(row.rate) === 0) {
    return "A displayed 0% means this county measured at zero with a valid denominator.";
  }
  return "";
}

function buildWithheldNote(context) {
  if (!context.support) {
    return "Loading support information...";
  }
  if (context.support.raw_support_status === "incomplete") {
    return incompleteMessage(context.support);
  }
  if (context.rawRows.length) {
    return context.support.dashboard_eligibility_note || "The ACS input tables do not provide a supported county subgroup for this dimension set.";
  }
  return "The ACS input tables do not support county publishing for this dimension set.";
}

function buildGlobalNote(rows, context) {
  const support = context.support;
  if (!support) {
    return "Loading support information...";
  }
  if (!rows.length) {
    return buildWithheldNote(context);
  }
  const numericRows = getNumericRows(rows);
  if (!numericRows.length) {
    return "This selection has no numeric county rates to rank. Suppressed, unavailable, and incomplete states are shown explicitly instead of being converted to 0%.";
  }
  const lowest = numericRows[0];
  const highest = numericRows[numericRows.length - 1];
  return `County range spans from ${formatValue(lowest)} in ${state.countyNameByFips.get(lowest.county_fips)} to ${formatValue(highest)} in ${state.countyNameByFips.get(highest.county_fips)}. Suppressed and unavailable states remain distinct from a measured 0%.`;
}

function globalValueText(rows, context) {
  const support = context.support;
  if (!support) {
    return "Loading...";
  }
  if (!rows.length) {
    return support.raw_support_status === "incomplete" ? "Incomplete" : "Unsupported";
  }
  return `${rows.length}-county summary`;
}

function renderSummaryCounts(rows, support) {
  const usableCount =
    rows.length
      ? countStatuses(rows).usable
      : state.selectedSubgroup && support
        ? toCount(support.usable_county_count)
        : null;
  const baseCount = Number(state.data?.metadata?.county_count || 64);
  const usableNode = document.getElementById("summary-usable");
  const shareNode = document.getElementById("summary-usable-share");
  if (usableNode) {
    usableNode.textContent = usableCount === null ? "--" : String(usableCount);
  }
  if (shareNode) {
    if (usableCount === null || baseCount <= 0) {
      shareNode.textContent = "--";
    } else {
      const sharePct = ((usableCount / baseCount) * 100).toFixed(1);
      shareNode.textContent = `(${sharePct}% of ${baseCount} counties)`;
    }
  }
}

function getDetailSupportLabel(support) {
  if (!support) {
    return "--";
  }
  return getSupportStatusLabel(support.raw_support_status);
}

function getDefinitionField(support, field) {
  return (
    support?.[field] ||
    getCurrentIndicatorMeta()?.[field] ||
    "--"
  );
}

function renderDetailPanel() {
  const context = getCurrentSupportContext();
  const rows = getCurrentRows();
  const support = context.support;
  const indicatorLabel = getCurrentIndicatorLabel();
  const row =
    state.selectedCounty && state.selectedSubgroup
      ? state.countyRowsByIndicatorSubgroup.get(keyFor(state.selectedIndicator, state.selectedSubgroup, state.selectedCounty)) || null
      : null;

  renderSummaryCounts(rows, support);

  document.getElementById("detail-indicator").textContent = indicatorLabel;
  document.getElementById("detail-subgroup").textContent =
    state.selectedSubgroup && support?.subgroup_label ? support.subgroup_label : "No supported subgroup";
  document.getElementById("detail-support").textContent = getDetailSupportLabel(support);
  document.getElementById("detail-source").textContent = getCurrentSourceLabel(rows, row, support);
  const health = isHealthOutcome();
  const meta = getCurrentIndicatorMeta();
  document.getElementById("definition-title").textContent = health ? "About this estimate" : "Metric Definition";
  document.getElementById("definition-formula").textContent = health ? `${meta.definition} ${meta.interpretation_note}` : getDefinitionField(support, "formula_expression");
  document.getElementById("health-estimate-details").hidden = !health;
  document.getElementById("detail-ci").textContent = row && health ? `${Number(row.ci_lower_pct).toFixed(1)}%–${Number(row.ci_upper_pct).toFixed(1)}%` : "Select a county";
  document.getElementById("ranking-title").textContent = health ? "County comparison: age-adjusted prevalence" : "County ranking for current view";
  document.getElementById("health-ranking-note").hidden = !health;

  if (state.selectedCounty && row) {
    document.getElementById("selected-county").textContent = state.countyNameByFips.get(state.selectedCounty) || "County selected";
    document.getElementById("selected-value").textContent = formatValue(row);
    document.getElementById("selected-status").innerHTML = "";
    document.getElementById("detail-note").textContent = health ? "Model-based age-adjusted estimate. It is not a patient count. Consider the confidence interval when comparing counties." : buildCountyNote(row);
    return;
  }

  document.getElementById("selected-county").textContent = "Colorado Counties";
  document.getElementById("selected-value").textContent = globalValueText(rows, context);
  if (rows.length) {
    document.getElementById("selected-status").innerHTML = [
      detailTag(`Support: ${getDetailSupportLabel(support)}`),
      detailTag(`Counties in view: ${rows.length}`),
    ].join("");
  } else {
    document.getElementById("selected-status").innerHTML = [
      detailTag(`Support: ${getDetailSupportLabel(support)}`),
      detailTag(`Counties in view: ${state.data?.metadata?.county_count || 64}`),
    ].join("");
  }
  document.getElementById("detail-note").textContent = health ? "Select a county to view its estimate and 95% confidence interval. County ordering is descriptive; small differences may not be meaningful." : buildGlobalNote(rows, context);
}

function renderRanking() {
  const list = document.getElementById("ranking-list");
  list.innerHTML = "";
  const rows = getCurrentRows()
    .slice()
    .sort((left, right) => {
      if (left.data_status !== right.data_status) {
        return STATUS_PRIORITY[right.data_status] - STATUS_PRIORITY[left.data_status];
      }
      const leftRate = toNumber(left.rate) ?? -1;
      const rightRate = toNumber(right.rate) ?? -1;
      if (leftRate !== rightRate) {
        return rightRate - leftRate;
      }
      return state.countyNameByFips.get(left.county_fips).localeCompare(state.countyNameByFips.get(right.county_fips));
    });
  if (!rows.length) {
    const message = document.createElement("p");
    message.className = "ranking-empty";
    message.textContent = buildWithheldNote(getCurrentSupportContext());
    list.appendChild(message);
    return;
  }

  const maxRate = Math.max(0, ...rows.map((row) => toNumber(row.rate) || 0));
  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = `ranking-item ${row.county_fips === state.selectedCounty ? "is-active" : ""}`;
    const width = maxRate > 0 && toNumber(row.rate) !== null ? `${(Number(row.rate) / maxRate) * 100}%` : "0%";
    item.innerHTML = `
      <button type="button" data-county="${row.county_fips}">${state.countyNameByFips.get(row.county_fips)}</button>
      <div class="ranking-bar"><span class="ranking-bar-fill" style="width:${width}"></span></div>
      <div class="ranking-value">${formatValue(row)}</div>
    `;
    item.querySelector("button").addEventListener("click", () => {
      state.selectedCounty = row.county_fips;
      renderDetailPanel();
      renderMap();
      renderRanking();
    });
    list.appendChild(item);
  });
}

function renderMetrics() {
  setMetric("county_count", state.data.metadata.county_count);
  setMetric("indicator_count", state.data.metadata.indicators.length);
  const visibleIndicatorKeys = new Set(state.data.metadata.indicators.map((indicator) => indicator.indicator_key));
  const subgroupCount = state.data.support_matrix.filter(
    (row) => row.subgroup_key && visibleIndicatorKeys.has(row.indicator_key) && RAW_SUPPORTED_STATUSES.has(row.raw_support_status)
  ).length;
  setMetric("subgroup_count", subgroupCount);
}

function render() {
  renderDomainPills();
  renderIndicatorSelect();
  renderDimensionPills();
  renderSubgroupSelect();
  renderStatusBand();
  renderMap();
  renderDetailPanel();
  renderRanking();
  renderMetrics();
}

async function loadData() {
  if (window.COLORADO_EQUITY_DASHBOARD_DATA) {
    return window.COLORADO_EQUITY_DASHBOARD_DATA;
  }
  throw new Error("Dashboard dashboard data script was not loaded. Open the local HTML page together with its bundled assets.");
}

function initializeState() {
  state.selectedDomain = state.data.metadata.domains[0]?.domain_key || null;
  state.selectedDimensions = [];
  state.selectedCounty = null;
  resetIndicatorIfNeeded();
  resetSubgroupIfNeeded();
}

async function init() {
  setupRevealAnimations();
  setupFaqAnimations();
  injectRuntimeMetadata();
  try {
    state.data = await loadData();
    buildIndexes(state.data);
    initializeState();
    initializeMap();
    render();
  } catch (error) {
    const status = document.getElementById("status-band");
    status.dataset.tone = "danger";
    status.textContent = "Dashboard data could not be loaded. Re-run the build script to regenerate local assets, or open the page through a local web server if JSON fetch is required.";
    console.error(error);
  }
}

document.addEventListener("DOMContentLoaded", init);
