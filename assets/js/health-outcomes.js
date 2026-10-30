/* Independent, overall-only comparison page. No homepage demographic state is shared. */
(() => {
  "use strict";

  const COLORS = ["#f4e2c5", "#e4bc84", "#d47d61", "#b6404a", "#7e2030"];
  const STATUS_LABELS = { suppressed: "Suppressed", unavailable: "Unavailable", incomplete: "Incomplete" };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SELECTED_COLOR = "var(--county-selected-fill)";

  function numberOrNull(value) {
    if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function valueOf(row) {
    if (row?.data_status !== "usable") return null;
    const value = numberOrNull(row.rate_pct);
    return value !== null && value >= 0 && value <= 100 ? value : null;
  }

  function formatValue(row) {
    if (valueOf(row) !== null) return `${row.rate_pct}%`;
    return STATUS_LABELS[row?.data_status] || "Unavailable";
  }

  function buildView(rows, counties) {
    const byCounty = new Map(rows.map(row => [row.county_fips, row]));
    const entries = counties.map(county => ({ ...county, row: byCounty.get(county.fips) || null }));
    entries.sort((a, b) => {
      const aValue = valueOf(a.row);
      const bValue = valueOf(b.row);
      if (aValue !== null && bValue !== null) return bValue - aValue || a.name.localeCompare(b.name, "en");
      if (aValue !== null) return -1;
      if (bValue !== null) return 1;
      return a.name.localeCompare(b.name, "en");
    });
    const valid = entries.filter(entry => valueOf(entry.row) !== null);
    const ranks = new Map();
    let previousValue = null;
    let rank = 0;
    valid.forEach((entry, index) => {
      const value = valueOf(entry.row);
      if (value !== previousValue) rank = index + 1;
      ranks.set(entry.fips, rank);
      previousValue = value;
    });
    return {
      byCounty, entries, valid, ranks,
      extents: valid.length ? { min: valueOf(valid[valid.length - 1].row), max: valueOf(valid[0].row) } : null,
    };
  }

  function colorForValue(value, extents) {
    if (value === null || !extents) return "#dfe3df";
    if (extents.max === extents.min) return COLORS[2];
    const position = (value - extents.min) / (extents.max - extents.min);
    return COLORS[Math.min(COLORS.length - 1, Math.max(0, Math.floor(position * COLORS.length)))];
  }

  // The pure data rules can be checked with Node, without exposing page state in the browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { numberOrNull, valueOf, formatValue, buildView, colorForValue };
  }
  if (typeof document === "undefined") return;

  const state = {
    selectedCounty: null,
    left: { key: "unemployment_rate", health: false, rankingNodes: new Map(), hoveredCounty: null, focusedCounty: null },
    right: { key: "diagnosed_diabetes", health: true, rankingNodes: new Map(), hoveredCounty: null, focusedCounty: null },
  };
  let counties = [];
  let features = [];
  let indicators;
  let support;
  let rowsByIndicator;

  const node = id => document.getElementById(id);
  const setText = (id, text) => { node(id).textContent = text; };
  function svgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function coordinates(geometry) {
    return (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates).flat(2);
  }

  function createProjection() {
    const points = features.flatMap(feature => coordinates(feature.geometry));
    const lons = points.map(point => point[0]);
    const lats = points.map(point => point[1]);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const scale = Math.min(904 / (maxLon - minLon), 564 / (maxLat - minLat));
    const offsetX = (960 - (maxLon - minLon) * scale) / 2;
    const offsetY = (620 - (maxLat - minLat) * scale) / 2;
    return ([lon, lat]) => [offsetX + (lon - minLon) * scale, 620 - offsetY - (lat - minLat) * scale];
  }

  function geometryPath(geometry, project) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map(polygon => polygon.map(ring => ring.map((point, index) => {
      const [x, y] = project(point);
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ") + " Z").join(" ")).join(" ");
  }

  function createMap(side, project) {
    const svg = node(`${side}-map`);
    const panel = state[side];
    const defs = svgElement("defs");
    const pattern = svgElement("pattern", { id: `${side}-suppressed`, width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pattern.append(svgElement("rect", { width: 8, height: 8, fill: "#f4d9bf" }), svgElement("line", { x1: 0, y1: 0, x2: 0, y2: 8, stroke: "#855f33", "stroke-width": 2 }));
    defs.append(pattern);
    const background = svgElement("rect", { x: 0, y: 0, width: 960, height: 620, fill: "transparent", class: "comparison-map-background" });
    background.addEventListener("click", () => selectCounty(null));
    const layer = svgElement("g");
    const selectionOverlay = svgElement("path", { class: "comparison-selection-overlay", "aria-hidden": "true", focusable: "false", "pointer-events": "none", visibility: "hidden" });
    const hoverOverlay = svgElement("path", { class: "comparison-hover-overlay", "aria-hidden": "true", focusable: "false", "pointer-events": "none", visibility: "hidden" });
    svg.append(defs, background, layer, selectionOverlay, hoverOverlay);
    svg.addEventListener("pointerdown", () => {
      panel.focusedCounty = null;
      renderMapFeedback(side);
    });
    svg.addEventListener("pointerleave", () => {
      panel.hoveredCounty = null;
      renderMapFeedback(side);
    });
    const paths = new Map();
    features.forEach(feature => {
      const fips = feature.id;
      const path = svgElement("path", { d: geometryPath(feature.geometry, project), class: "comparison-county", role: "button", tabindex: "-1", "data-fips": fips, "aria-pressed": "false", "aria-describedby": `${side}-map-help` });
      const title = svgElement("title");
      path.append(title);
      path.addEventListener("click", () => selectCounty(fips));
      path.addEventListener("pointerenter", event => {
        if (event.pointerType === "touch") return;
        panel.hoveredCounty = fips;
        renderMapFeedback(side);
      });
      path.addEventListener("pointerleave", () => {
        if (panel.hoveredCounty === fips) panel.hoveredCounty = null;
        renderMapFeedback(side);
      });
      path.addEventListener("focus", () => {
        panel.focusedCounty = path.matches(":focus-visible") ? fips : null;
        renderMapFeedback(side);
      });
      path.addEventListener("blur", () => {
        if (panel.focusedCounty === fips) panel.focusedCounty = null;
        renderMapFeedback(side);
      });
      path.addEventListener("keydown", event => {
        if (["Enter", " ", "Escape", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
          panel.focusedCounty = fips;
          renderMapFeedback(side);
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectCounty(fips);
        } else if (event.key === "Escape") {
          event.preventDefault();
          selectCounty(null);
        } else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const index = counties.findIndex(county => county.fips === fips);
          const step = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
          const next = event.key === "Home" ? 0 : event.key === "End" ? counties.length - 1 : (index + step + counties.length) % counties.length;
          paths.forEach(item => item.path.setAttribute("tabindex", "-1"));
          const nextPath = paths.get(counties[next].fips).path;
          nextPath.setAttribute("tabindex", "0");
          nextPath.focus({ preventScroll: true });
        }
      });
      const projected = coordinates(feature.geometry).map(project);
      const xs = projected.map(point => point[0]), ys = projected.map(point => point[1]);
      paths.set(fips, { path, title, center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] });
      layer.append(path);
    });
    return { paths, selectionOverlay, hoverOverlay };
  }

  function renderMapFeedback(side) {
    const panel = state[side];
    if (!panel.map) return;
    const { paths, selectionOverlay, hoverOverlay } = panel.map;
    const selected = paths.get(state.selectedCounty);
    const activeFips = panel.hoveredCounty || panel.focusedCounty;
    const active = paths.get(activeFips);
    // A focused or hovered selection needs only its enlarged outline.
    selectionOverlay.setAttribute("visibility", selected && activeFips !== state.selectedCounty ? "visible" : "hidden");
    selectionOverlay.dataset.fips = selected ? state.selectedCounty : "";
    if (selected) selectionOverlay.setAttribute("d", selected.path.getAttribute("d"));

    hoverOverlay.setAttribute("visibility", active ? "visible" : "hidden");
    hoverOverlay.dataset.fips = active ? activeFips : "";
    if (!active) return;
    const [x, y] = active.center;
    hoverOverlay.setAttribute("d", active.path.getAttribute("d"));
    hoverOverlay.setAttribute("transform", `translate(${x} ${y}) scale(1.10) translate(${-x} ${-y})`);
    hoverOverlay.style.fill = activeFips === state.selectedCounty ? SELECTED_COLOR : active.path.style.fill;
  }

  function renderLegend(side) {
    const container = node(`${side}-legend`);
    const extents = state[side].view.extents;
    container.replaceChildren();
    if (!extents) {
      container.textContent = "No available numeric estimates.";
      return;
    }
    const count = extents.min === extents.max ? 1 : COLORS.length;
    for (let index = 0; index < count; index += 1) {
      const start = extents.min + (extents.max - extents.min) * index / count;
      const end = extents.min + (extents.max - extents.min) * (index + 1) / count;
      const bin = document.createElement("span");
      bin.className = "legend-bin";
      const swatch = document.createElement("i");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = count === 1 ? COLORS[2] : COLORS[index];
      swatch.setAttribute("aria-hidden", "true");
      const label = count === 1 ? `${start.toFixed(1)}%` : `${start.toFixed(1)}–${end.toFixed(1)}%`;
      bin.append(swatch, document.createTextNode(label));
      container.append(bin);
    }
    const statuses = new Set(state[side].view.entries.map(entry => valueOf(entry.row) === null ? entry.row?.data_status || "unavailable" : "usable"));
    for (const [status, label] of Object.entries(STATUS_LABELS)) {
      if (!statuses.has(status)) continue;
      const key = document.createElement("span");
      key.className = "legend-bin";
      const swatch = document.createElement("i");
      swatch.className = `legend-swatch ${status === "suppressed" ? "legend-swatch-suppressed" : "legend-swatch-muted"}`;
      swatch.setAttribute("aria-hidden", "true");
      key.append(swatch, document.createTextNode(label));
      container.append(key);
    }
  }

  function renderMapValues(side) {
    const { view, map } = state[side];
    const meta = indicators.get(state[side].key);
    map.paths.forEach(({ path, title }, fips) => {
      const row = view.byCounty.get(fips);
      path.style.fill = row?.data_status === "suppressed" ? `url(#${side}-suppressed)` : colorForValue(valueOf(row), view.extents);
      const name = counties.find(county => county.fips === fips).name;
      const label = `${name}: ${meta.indicator_label}, ${formatValue(row)}`;
      path.setAttribute("aria-label", label);
      title.textContent = label;
    });
    renderLegend(side);
  }

  function renderRanking(side) {
    const panel = state[side];
    const list = node(`${side}-ranking-list`);
    const fragment = document.createDocumentFragment();
    panel.rankingNodes.clear();
    panel.view.entries.forEach(entry => {
      const item = document.createElement("li");
      item.className = "comparison-ranking-item";
      item.dataset.fips = entry.fips;
      const rank = document.createElement("span");
      rank.className = "comparison-rank";
      rank.textContent = panel.view.ranks.get(entry.fips) || "—";
      rank.setAttribute("aria-label", panel.view.ranks.has(entry.fips) ? `Rank ${panel.view.ranks.get(entry.fips)}` : "Not ranked");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "comparison-county-button";
      button.textContent = entry.name;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => selectCounty(entry.fips));
      const track = document.createElement("span");
      track.className = "comparison-ranking-track";
      track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.className = "comparison-ranking-fill";
      const value = valueOf(entry.row);
      fill.style.width = `${value !== null && panel.view.extents?.max > 0 ? value / panel.view.extents.max * 100 : 0}%`;
      track.append(fill);
      const valueText = document.createElement("span");
      valueText.className = "comparison-ranking-value";
      valueText.textContent = formatValue(entry.row);
      item.append(rank, button, track, valueText);
      fragment.append(item);
      panel.rankingNodes.set(entry.fips, { item, button });
    });
    list.replaceChildren(fragment);
    list.scrollTop = 0;
  }

  function revealRankingSelection(side) {
    const list = node(`${side}-ranking-list`);
    const entry = state[side].rankingNodes.get(state.selectedCounty)?.item;
    if (!entry || list.scrollHeight <= list.clientHeight) return;
    // Scroll the list only; scrollIntoView would also move the document away from the maps.
    const itemRect = entry.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top + 4;
    else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom + 4;
  }

  function renderSelection(side, reveal = false) {
    const panel = state[side];
    const fips = state.selectedCounty;
    panel.map.paths.forEach(({ path }, countyFips) => {
      const selected = fips === countyFips;
      path.classList.toggle("is-selected", selected);
      path.setAttribute("aria-pressed", String(selected));
      path.setAttribute("tabindex", countyFips === (fips || counties[0].fips) ? "0" : "-1");
    });
    renderMapFeedback(side);
    panel.rankingNodes.forEach(({ item, button }, countyFips) => {
      item.classList.toggle("is-active", fips === countyFips);
      button.setAttribute("aria-pressed", String(fips === countyFips));
    });
    renderSummary(side);
    if (reveal) revealRankingSelection(side);
  }

  function renderSummary(side) {
    const panel = state[side];
    const { view } = panel;
    const selected = counties.find(county => county.fips === state.selectedCounty);
    const row = selected ? view.byCounty.get(selected.fips) : null;
    const meta = indicators.get(panel.key);
    setText(`${side}-summary-title`, selected ? selected.name : "Colorado counties");
    setText(`${side}-summary-value`, selected ? formatValue(row) : `${view.valid.length} / ${counties.length}`);
    const ranking = view.ranks.get(state.selectedCounty);
    setText(`${side}-summary-detail`, selected
      ? `${meta.indicator_label} · ${ranking ? `Rank ${ranking} of ${view.valid.length} available counties (highest first)` : "No published numeric rank"}`
      : `${meta.indicator_label} · counties with available estimates`);
    if (view.valid.length) {
      const lowest = view.valid[view.valid.length - 1];
      const highest = view.valid[0];
      setText(`${side}-summary-range`, `County range: ${formatValue(lowest.row)}–${formatValue(highest.row)}. ${view.valid.length} of ${counties.length} counties available.`);
    } else setText(`${side}-summary-range`, "No available numeric estimates for this indicator.");
  }

  function announce() {
    const selected = counties.find(county => county.fips === state.selectedCounty);
    const messages = [selected ? selected.name : "Colorado-wide county overview"];
    for (const side of ["left", "right"]) {
      const panel = state[side];
      const meta = indicators.get(panel.key);
      messages.push(`${meta.indicator_label}: ${selected ? formatValue(panel.view.byCounty.get(selected.fips)) : `${panel.view.valid.length} counties available`}`);
    }
    setText("comparison-announcement", messages.join(". "));
  }

  function selectCounty(fips) {
    state.selectedCounty = counties.some(county => county.fips === fips) ? fips : null;
    ["left", "right"].forEach(side => renderSelection(side, true));
    announce();
  }

  function renderIndicator(side) {
    const panel = state[side];
    const meta = indicators.get(panel.key);
    const context = support.get(panel.key);
    panel.view = buildView(rowsByIndicator.get(panel.key) || [], counties);
    setText(`${side}-map-title`, meta.indicator_label);
    const universe = context?.standard_universe_label || meta.standard_universe_label || "";
    setText(`${side}-population`, panel.health ? "Age-adjusted prevalence (%) · Adults aged 18+" : `Overall · ${universe.replace(/^Selected subgroup members/, "People")}`);
    setText(`${side}-ranking-title`, `${meta.indicator_label}: county ranking`);
    setText(`${side}-source`, panel.health
      ? `${meta.source_display_label}. Adults aged 18+. Age-adjusted prevalence (%).`
      : `ACS 2024 five-year estimates (2020–2024). ${context?.source_display_label || meta.source_display_label}.`);
    const firstRow = panel.view.valid[0]?.row;
    setText(`${side}-definition`, panel.health ? meta.definition : (firstRow?.source_note || context?.formula_expression || meta.formula_expression || ""));
    if (panel.health) setText("right-interpretation", meta.interpretation_note || "");
    renderMapValues(side);
    renderRanking(side);
    renderSelection(side, true);
  }

  function initialize() {
    try {
      const data = window.COLORADO_HEALTH_COMPARISON_DATA;
      if (!data?.metadata?.indicators || !data?.geojson?.features || !data?.canonical) throw new Error("Comparison data was not loaded.");
      features = data.geojson.features;
      counties = features.map(feature => ({ fips: feature.id, name: feature.properties.county_name })).sort((a, b) => a.name.localeCompare(b.name, "en"));
      indicators = new Map(data.metadata.indicators.map(meta => [meta.indicator_key, meta]));
      support = new Map(data.support_matrix.filter(row => row.subgroup_key === "overall").map(row => [row.indicator_key, row]));
      rowsByIndicator = new Map();
      const unique = new Set();
      data.canonical.forEach(row => {
        if (row.subgroup_key !== "overall" || !indicators.has(row.indicator_key)) return;
        if (indicators.get(row.indicator_key).domain_key === "health_outcomes" && row.estimate_type !== "age_adjusted") return;
        const key = `${row.indicator_key}:${row.county_fips}`;
        if (unique.has(key)) throw new Error(`Duplicate county estimate: ${key}`);
        unique.add(key);
        if (!rowsByIndicator.has(row.indicator_key)) rowsByIndicator.set(row.indicator_key, []);
        rowsByIndicator.get(row.indicator_key).push(row);
      });
      document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || event.defaultPrevented || !state.selectedCounty || event.target.closest("select")) return;
        event.preventDefault();
        selectCounty(null);
      });
      const project = createProjection();
      for (const side of ["left", "right"]) {
        const panel = state[side];
        const options = data.metadata.indicators.filter(meta => (meta.domain_key === "health_outcomes") === panel.health);
        if (!options.some(meta => meta.indicator_key === panel.key)) panel.key = options[0]?.indicator_key;
        if (!panel.key) throw new Error(`No indicators available for ${side}.`);
        const select = node(`${side}-indicator`);
        select.replaceChildren(...options.map(meta => new Option(meta.indicator_label, meta.indicator_key, false, meta.indicator_key === panel.key)));
        select.addEventListener("change", () => {
          panel.key = select.value;
          renderIndicator(side);
          announce();
        });
        panel.map = createMap(side, project);
        renderIndicator(side);
      }
      node("comparison-status").hidden = true;
      announce();
    } catch (error) {
      const status = node("comparison-status");
      status.hidden = false;
      status.setAttribute("role", "alert");
      status.textContent = "The comparison data could not be loaded. Please reload this page or return to the dashboard.";
      ["left-indicator", "right-indicator"].forEach(id => { node(id).disabled = true; });
      console.error(error);
    }
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
