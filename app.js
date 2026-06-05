/* =============================================================
   Breathing Unequally — Expanded WDI Dashboard
   D3 v7 static dashboard. Data is embedded by data.js.
   ============================================================= */

const tooltip = d3.select("#tooltip");

const COLORS = {
  risk: "#c35134",
  riskDeep: "#873019",
  teal: "#247a70",
  blue: "#315f8f",
  amber: "#b98d28",
  plum: "#73577f",
  green: "#4f8b57",
  muted: "#66736d",
  ink: "#1d2a25",
  pale: "#f3ede3",
};

const INCOME_ORDER = [
  "Low income",
  "Lower middle income",
  "Upper middle income",
  "High income",
  "Not classified",
];

const incomeColor = d3
  .scaleOrdinal()
  .domain(INCOME_ORDER)
  .range([COLORS.riskDeep, COLORS.risk, COLORS.amber, COLORS.teal, COLORS.plum]);

const state = {
  selectedCountry: "Malaysia",
  selectedYear: 2019,
  selectedRegion: "all",
  selectedIncome: "all",
  data: null,
  geo: null,
  mapLayer: null,
  zoomBehavior: null,
  isPlaying: false,
  playTimer: null,
  brushedCodes: null,
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  if (!window.DASHBOARD_DATA || !window.WORLD_GEO) {
    d3.select("#country-profile").html("<p>Dashboard data could not be loaded.</p>");
    return;
  }
  state.data = window.DASHBOARD_DATA;
  state.geo = window.WORLD_GEO;
  state.selectedYear = state.data.metadata.latestYear;
  if (!state.data.countries.some((row) => row.country === state.selectedCountry)) {
    state.selectedCountry = state.data.countries[0].country;
  }
  initControls();
  setupMap();
  updateDashboard();
  window.addEventListener("resize", debounce(() => {
    setupMap(true);
    updateDashboard();
  }, 180));
}

function initControls() {
  const { metadata, countries, regions, incomeGroups } = state.data;
  d3.select("#source-note").text(
    `Source: ${metadata.source}. ${metadata.countryCount} countries/economies, ${metadata.earliestYear}-${metadata.latestYear}. Retrieved ${metadata.retrieved}.`,
  );

  const countrySelect = d3.select("#country-select");
  countrySelect
    .selectAll("option")
    .data(countries)
    .join("option")
    .attr("value", (d) => d.country)
    .text((d) => d.country);
  countrySelect.property("value", state.selectedCountry).on("change", (event) => {
    state.selectedCountry = event.target.value;
    updateDashboard();
  });

  d3.select("#year-slider")
    .attr("min", metadata.earliestYear)
    .attr("max", metadata.latestYear)
    .property("value", state.selectedYear)
    .on("input", (event) => {
      state.selectedYear = Number(event.target.value);
      updateDashboard();
    });

  d3.select("#region-select")
    .selectAll("option")
    .data(["all", ...regions])
    .join("option")
    .attr("value", (d) => d)
    .text((d) => (d === "all" ? "All regions" : d));
  d3.select("#region-select").on("change", (event) => {
    state.selectedRegion = event.target.value;
    updateDashboard();
  });

  d3.select("#income-select")
    .selectAll("option")
    .data(["all", ...incomeGroups])
    .join("option")
    .attr("value", (d) => d)
    .text((d) => (d === "all" ? "All income groups" : d));
  d3.select("#income-select").on("change", (event) => {
    state.selectedIncome = event.target.value;
    updateDashboard();
  });

  d3.select("#play-button").on("click", togglePlay);
  d3.select("#reset-view").on("click", resetView);
}

function updateDashboard() {
  d3.select("#year-value").text(state.selectedYear);
  d3.select("#country-select").property("value", state.selectedCountry);
  d3.select("#year-slider").property("value", state.selectedYear);
  d3.select("#region-select").property("value", state.selectedRegion);
  d3.select("#income-select").property("value", state.selectedIncome);

  state.brushedCodes = null;
  updateMetrics();
  updateMap();
  drawIncomeChart();
  drawGdpScatter();
  drawHealthScatter();
  drawTrendChart();
  updateCountryProfile();
}

// Linked brushing: highlight the brushed countries across every coordinated
// view (both scatter plots and the choropleth map) and fade the rest.
function applyBrush(codes) {
  state.brushedCodes = codes;
  const active = codes && codes.size > 0;
  d3.selectAll(".scatter-dot")
    .classed("brushed", (d) => active && codes.has(d.code))
    .classed("brush-faded", (d) => active && !codes.has(d.code));
  d3.select("#map-chart")
    .selectAll(".country-shape")
    .classed("brushed", (feature) => active && codes.has(feature.id))
    .classed("brush-faded", (feature) => active && !codes.has(feature.id));
}

function currentYear() {
  return state.data.yearly.find((row) => row.year === state.selectedYear);
}

function selectedCountry() {
  return state.data.countries.find((row) => row.country === state.selectedCountry);
}

function selectedRecord(year = state.selectedYear) {
  const country = selectedCountry();
  return country?.series.find((row) => row.year === year) || null;
}

// Value for the selected year; if that year is missing, fall back to the
// latest year that has data for this field (e.g. WHO-exceedance ends in 2017).
function valueWithFallback(field) {
  const country = selectedCountry();
  if (!country) return null;
  const selected = country.series.find((row) => row.year === state.selectedYear);
  if (selected && selected[field] != null) {
    return { value: selected[field], year: state.selectedYear, fallback: false };
  }
  const available = country.series.filter((row) => row[field] != null);
  if (!available.length) return null;
  const last = available.reduce((a, b) => (b.year > a.year ? b : a));
  return { value: last[field], year: last.year, fallback: true };
}

function passesFilters(row, { ignoreIncome = false } = {}) {
  const regionOk = state.selectedRegion === "all" || row.region === state.selectedRegion;
  const incomeOk = ignoreIncome || state.selectedIncome === "all" || row.income_group === state.selectedIncome;
  return regionOk && incomeOk;
}

function filteredValues({ requirePm25 = false, ignoreIncome = false } = {}) {
  return currentYear().values.filter((row) => {
    if (!passesFilters(row, { ignoreIncome })) return false;
    if (requirePm25 && row.pm25_mean == null) return false;
    return true;
  });
}

function updateMetrics() {
  const rec = selectedRecord();
  const country = selectedCountry();
  setMetric("#metric-pm25", "#metric-pm25-note", fmt(rec?.pm25_mean, " ug/m3"), `${state.selectedCountry} in ${state.selectedYear}`);
  const who = valueWithFallback("pm25_who_exceed_pct");
  setMetric(
    "#metric-who",
    "#metric-who-note",
    fmtPct(who?.value),
    who?.fallback
      ? `Population above WHO guideline (${who.year}, latest available)`
      : "Population exposed above WHO guideline",
  );
  setMetric(
    "#metric-mortality",
    "#metric-mortality-note",
    fmt(rec?.air_mortality_total, " /100k"),
    "Age-standardized mortality attributed to air pollution",
  );
  setMetric(
    "#metric-cooking",
    "#metric-cooking-note",
    fmtPct(rec?.clean_cooking_access_pct),
    "Access to clean fuels and technologies for cooking",
  );
  setMetric(
    "#metric-gdp",
    "#metric-gdp-note",
    fmtMoney(rec?.gdp_per_capita_2015usd),
    `${country?.income_group || "Income group unavailable"} · ${country?.region || "region unavailable"}`,
  );
}

function setMetric(valueId, noteId, value, note) {
  const isEmpty = !value || value === "No data";
  d3.select(valueId)
    .text(isEmpty ? "No data" : value)
    .classed("is-empty", isEmpty);
  d3.select(noteId).text(note);
}

function setupMap(force = false) {
  const svg = d3.select("#map-chart");
  if (state.mapLayer && !force) return;

  svg.selectAll("*").remove();
  const width = svg.node().getBoundingClientRect().width || 820;
  const height = 460;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const projection = d3.geoNaturalEarth1().fitSize([width, height], state.geo);
  const path = d3.geoPath(projection);
  const layer = svg.append("g").attr("class", "map-layer");

  layer
    .selectAll("path")
    .data(state.geo.features)
    .join("path")
    .attr("class", "country-shape")
    .attr("d", path)
    .on("mousemove", (event, feature) => {
      const rec = currentYear().values.find((row) => row.code === feature.id);
      const name = rec?.country || feature.properties.name;
      const value = rec?.pm25_mean == null ? "No PM2.5 data" : `${rec.pm25_mean.toFixed(2)} ug/m3`;
      showTooltip(event, `<strong>${name}</strong><br>${value}<br>${rec?.income_group || ""}`);
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, feature) => {
      const rec = currentYear().values.find((row) => row.code === feature.id);
      if (rec) {
        state.selectedCountry = rec.country;
        updateDashboard();
      }
    });

  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", "pm25-gradient");
  grad
    .selectAll("stop")
    .data([
      { offset: "0%", color: "#f7e5d3" },
      { offset: "48%", color: "#d97950" },
      { offset: "100%", color: "#873019" },
    ])
    .join("stop")
    .attr("offset", (d) => d.offset)
    .attr("stop-color", (d) => d.color);

  const legend = svg.append("g").attr("transform", `translate(${width - 235},${height - 42})`);
  legend.append("rect").attr("width", 180).attr("height", 10).attr("rx", 5).attr("fill", "url(#pm25-gradient)");
  legend
    .append("text")
    .attr("class", "legend-label")
    .attr("x", 0)
    .attr("y", -8)
    .text("PM2.5 mean exposure (ug/m3)");
  legend
    .append("g")
    .attr("class", "axis")
    .attr("transform", "translate(0,10)")
    .call(d3.axisBottom(d3.scaleLinear().domain([0, 80]).range([0, 180])).ticks(4))
    .call((g) => g.select(".domain").remove());

  state.zoomBehavior = d3.zoom().scaleExtent([1, 6]).on("zoom", (event) => layer.attr("transform", event.transform));
  svg.call(state.zoomBehavior);
  state.mapLayer = layer;
}

function updateMap() {
  const values = new Map(currentYear().values.map((row) => [row.code, row]));
  const filteredCodes = new Set(filteredValues().map((row) => row.code));
  const color = d3
    .scaleSequential()
    .domain([0, 80])
    .interpolator(d3.interpolateRgbBasis(["#f7e5d3", "#d97950", "#873019"]));

  d3.select("#map-chart")
    .selectAll(".country-shape")
    .transition()
    .duration(300)
    .attr("fill", (feature) => {
      const rec = values.get(feature.id);
      return rec?.pm25_mean == null ? "#e8dfd2" : color(rec.pm25_mean);
    })
    .attr("class", (feature) => {
      const rec = values.get(feature.id);
      let cls = "country-shape";
      if (rec?.country === state.selectedCountry) cls += " selected";
      if (rec && !filteredCodes.has(rec.code)) cls += " dim";
      return cls;
    });
}

function drawIncomeChart() {
  const svg = prepSvg("#income-chart", 360);
  const width = svg.width;
  const height = svg.height;
  const margin = { top: 16, right: 30, bottom: 38, left: 150 };
  const iw = width - margin.left - margin.right;
  const ih = height - margin.top - margin.bottom;
  const values = currentYear().values.filter((row) => {
    if (state.selectedRegion !== "all" && row.region !== state.selectedRegion) return false;
    return row.pm25_mean != null && row.income_group !== "Not classified";
  });
  const grouped = d3
    .rollups(
      values,
      (rows) => ({
        pm25: d3.mean(rows, (row) => row.pm25_mean),
        who: d3.mean(rows, (row) => row.pm25_who_exceed_pct),
        count: rows.length,
      }),
      (row) => row.income_group,
    )
    .map(([name, row]) => ({ name, ...row }))
    .sort((a, b) => INCOME_ORDER.indexOf(a.name) - INCOME_ORDER.indexOf(b.name));

  if (!grouped.length) return drawEmpty(svg.root, width, height, "No income-group data for this filter.");

  const root = svg.root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const x = d3.scaleLinear().domain([0, d3.max(grouped, (d) => d.pm25) || 1]).nice().range([0, iw]);
  const y = d3.scaleBand().domain(grouped.map((d) => d.name)).range([0, ih]).padding(0.22);

  root
    .append("g")
    .attr("class", "grid")
    .call(d3.axisBottom(x).ticks(5).tickSize(ih).tickFormat(""))
    .call((g) => g.select(".domain").remove());

  root
    .selectAll(".bar")
    .data(grouped)
    .join("rect")
    .attr("class", "bar")
    .attr("x", 0)
    .attr("y", (d) => y(d.name))
    .attr("height", y.bandwidth())
    .attr("rx", 6)
    .attr("fill", (d) => (d.name === state.selectedIncome ? COLORS.risk : incomeColor(d.name)))
    .on("mousemove", (event, d) => showTooltip(event, `<strong>${d.name}</strong><br>Average PM2.5: ${d.pm25.toFixed(2)} ug/m3<br>${d.count} countries/economies`))
    .on("mouseleave", hideTooltip)
    .on("click", (_, d) => {
      state.selectedIncome = state.selectedIncome === d.name ? "all" : d.name;
      updateDashboard();
    })
    .attr("width", 0)
    .transition()
    .duration(620)
    .delay((_, i) => i * 70)
    .ease(d3.easeCubicOut)
    .attr("width", (d) => x(d.pm25));

  root
    .selectAll(".value-label")
    .data(grouped)
    .join("text")
    .attr("class", "annotation")
    .attr("y", (d) => y(d.name) + y.bandwidth() / 2 + 4)
    .attr("fill-opacity", 0)
    .attr("x", (d) => x(d.pm25) + 7)
    .text((d) => d.pm25.toFixed(1))
    .transition()
    .duration(620)
    .delay((_, i) => i * 70 + 180)
    .attr("fill-opacity", 1);

  root.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5));
  root.append("g").attr("class", "axis").call(d3.axisLeft(y).tickSize(0)).call((g) => g.select(".domain").remove());
  axisLabel(root, iw / 2, ih + 34, "PM2.5 mean exposure (ug/m3)");
}

function drawGdpScatter() {
  const year = state.data.scatter.find((row) => row.year === state.selectedYear);
  drawScatter("#gdp-scatter", year?.gdpVsPm25 || [], {
    xField: "gdp_per_capita_2015usd",
    yField: "pm25_mean",
    xLabel: "GDP per capita, constant 2015 US$",
    yLabel: "PM2.5 mean exposure (ug/m3)",
    xScale: "log",
    tooltip: (d) => `<strong>${d.country}</strong><br>GDP: ${fmtMoney(d.gdp_per_capita_2015usd)}<br>PM2.5: ${d.pm25_mean.toFixed(2)} ug/m3`,
  });
}

function drawHealthScatter() {
  let year = state.data.scatter.find((row) => row.year === state.selectedYear);
  let data = year?.cleanCookingVsMortality || [];
  let note = "";
  if (data.length < 10) {
    year = state.data.scatter.find((row) => row.year === state.data.metadata.latestYear);
    data = year?.cleanCookingVsMortality || [];
    note = `Health mortality data is sparse for ${state.selectedYear}; showing ${state.data.metadata.latestYear}.`;
  }
  drawScatter("#health-scatter", data, {
    xField: "clean_cooking_access_pct",
    yField: "air_mortality_total",
    xLabel: "Clean cooking access (% population)",
    yLabel: "Air-pollution mortality per 100k",
    xScale: "linear",
    note,
    tooltip: (d) => `<strong>${d.country}</strong><br>Clean cooking: ${fmtPct(d.clean_cooking_access_pct)}<br>Mortality: ${fmt(d.air_mortality_total, " /100k")}`,
  });
}

function drawScatter(selector, rows, config) {
  const svg = prepSvg(selector, 360);
  const width = svg.width;
  const height = svg.height;
  const margin = { top: 24, right: 24, bottom: 52, left: 62 };
  const iw = width - margin.left - margin.right;
  const ih = height - margin.top - margin.bottom;
  const data = rows.filter((row) => passesFilters(row) && row[config.xField] != null && row[config.yField] != null);

  if (!data.length) return drawEmpty(svg.root, width, height, "No data for the selected filters.");

  const xValues = data.map((d) => d[config.xField]).filter((d) => d > 0);
  const x =
    config.xScale === "log"
      ? d3.scaleLog().domain([Math.max(100, d3.min(xValues) || 100), d3.max(xValues) || 100000]).nice().range([0, iw])
      : d3.scaleLinear().domain(d3.extent(data, (d) => d[config.xField])).nice().range([0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d[config.yField]) || 1]).nice().range([ih, 0]);
  const r = d3.scaleSqrt().domain([0, d3.max(data, (d) => d.population || 1) || 1]).range([3, 14]);
  const root = svg.root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  root
    .append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(""))
    .call((g) => g.select(".domain").remove());

  // Brushing: drag a rectangle to select a subset of countries; the brush
  // sits below the dots so hover/click on a dot still works. Selected
  // countries are highlighted across the map and the other scatter plot.
  const brush = d3
    .brush()
    .extent([[0, 0], [iw, ih]])
    .on("brush end", (event) => {
      if (!event.selection) return applyBrush(null);
      const [[bx0, by0], [bx1, by1]] = event.selection;
      const codes = new Set(
        data
          .filter((d) => {
            const cx = x(d[config.xField]);
            const cy = y(d[config.yField]);
            return cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1;
          })
          .map((d) => d.code),
      );
      applyBrush(codes);
    });
  root.append("g").attr("class", "brush").call(brush);

  root
    .selectAll(".scatter-dot")
    .data(data, (d) => d.code)
    .join("circle")
    .attr("class", (d) => `scatter-dot ${d.country === state.selectedCountry ? "selected" : ""}`)
    .attr("cx", (d) => x(d[config.xField]))
    .attr("cy", (d) => y(d[config.yField]))
    .attr("fill", (d) => incomeColor(d.income_group))
    .on("mousemove", (event, d) => showTooltip(event, `${config.tooltip(d)}<br>${d.region}<br>${d.income_group}`))
    .on("mouseleave", hideTooltip)
    .on("click", (_, d) => {
      state.selectedCountry = d.country;
      updateDashboard();
    })
    .attr("r", 0)
    .attr("fill-opacity", 0)
    .transition()
    .duration(560)
    .delay((d) => Math.min(x(d[config.xField]) * 0.5, 360))
    .ease(d3.easeCubicOut)
    .attr("r", (d) => r(d.population || 1))
    .attr("fill-opacity", (d) => (d.country === state.selectedCountry ? 0.95 : 0.62));

  root.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5, config.xScale === "log" ? "~s" : undefined));
  root.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));
  axisLabel(root, iw / 2, ih + 42, config.xLabel);
  axisLabel(root, -ih / 2, -45, config.yLabel, -90);

  drawIncomeLegend(root, 0, -8);
  if (config.note) {
    root
      .append("text")
      .attr("class", "annotation")
      .attr("x", iw)
      .attr("y", -8)
      .attr("text-anchor", "end")
      .text(config.note);
  }
}

function drawTrendChart() {
  const svg = prepSvg("#trend-chart", 360);
  const width = svg.width;
  const height = svg.height;
  const margin = { top: 24, right: 92, bottom: 46, left: 58 };
  const iw = width - margin.left - margin.right;
  const ih = height - margin.top - margin.bottom;
  const country = selectedCountry();
  const series = country.series.filter((row) => row.pm25_mean != null);
  if (!series.length) return drawEmpty(svg.root, width, height, "No PM2.5 trend data for selected country.");

  const global = state.data.yearly.map((row) => ({ year: row.year, pm25_mean: row.averagePm25 })).filter((row) => row.pm25_mean != null);
  const x = d3.scaleLinear().domain(d3.extent(state.data.metadata.years)).range([0, iw]);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max([...series, ...global], (row) => row.pm25_mean) || 1])
    .nice()
    .range([ih, 0]);
  const root = svg.root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const line = d3.line().x((d) => x(d.year)).y((d) => y(d.pm25_mean));

  root.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat("")).call((g) => g.select(".domain").remove());
  root
    .append("rect")
    .attr("x", 0)
    .attr("y", y(state.data.metadata.whoGuidelinePm25))
    .attr("width", iw)
    .attr("height", ih - y(state.data.metadata.whoGuidelinePm25))
    .attr("fill", "rgba(36,122,112,0.08)");
  root
    .append("line")
    .attr("x1", 0)
    .attr("x2", iw)
    .attr("y1", y(state.data.metadata.whoGuidelinePm25))
    .attr("y2", y(state.data.metadata.whoGuidelinePm25))
    .attr("stroke", COLORS.teal)
    .attr("stroke-dasharray", "3 4");
  root.append("path").datum(global).attr("fill", "none").attr("stroke", COLORS.teal).attr("stroke-width", 2.2).attr("stroke-dasharray", "6 5").attr("d", line);

  const countryPath = root
    .append("path")
    .datum(series)
    .attr("fill", "none")
    .attr("stroke", COLORS.risk)
    .attr("stroke-width", 3)
    .attr("stroke-linecap", "round")
    .attr("d", line);
  const totalLen = countryPath.node().getTotalLength();
  countryPath
    .attr("stroke-dasharray", `${totalLen} ${totalLen}`)
    .attr("stroke-dashoffset", totalLen)
    .transition()
    .duration(820)
    .ease(d3.easeCubicInOut)
    .attr("stroke-dashoffset", 0)
    .on("end", () => countryPath.attr("stroke-dasharray", null));

  root
    .selectAll(".trend-dot")
    .data(series)
    .join("circle")
    .attr("cx", (d) => x(d.year))
    .attr("cy", (d) => y(d.pm25_mean))
    .attr("fill", COLORS.risk)
    .on("mousemove", (event, d) => showTooltip(event, `<strong>${country.country}</strong><br>${d.year}: ${d.pm25_mean.toFixed(2)} ug/m3`))
    .on("mouseleave", hideTooltip)
    .attr("r", 0)
    .transition()
    .duration(300)
    .delay((d, i) => 220 + i * (560 / Math.max(series.length, 1)))
    .attr("r", (d) => (d.year === state.selectedYear ? 5 : 3.5));
  root
    .append("line")
    .attr("x1", x(state.selectedYear))
    .attr("x2", x(state.selectedYear))
    .attr("y1", 0)
    .attr("y2", ih)
    .attr("stroke", "rgba(29,42,37,0.35)")
    .attr("stroke-dasharray", "4 4");

  root.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).tickFormat(d3.format("d")));
  root.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));
  axisLabel(root, iw / 2, ih + 38, "Year");
  axisLabel(root, -ih / 2, -42, "PM2.5 mean exposure (ug/m3)", -90);
  // Direct end-labels placed in the right margin, beside each line's last
  // point, so they never sit on the lines or the year-cursor.
  const globalY = y(global.at(-1).pm25_mean);
  let countryY = y(series.at(-1).pm25_mean);
  if (Math.abs(countryY - globalY) < 13) countryY = globalY + 13; // avoid label collision
  root.append("text").attr("class", "annotation").attr("x", iw + 8).attr("y", globalY + 4).attr("text-anchor", "start").attr("fill", COLORS.teal).text("Global avg");
  root.append("text").attr("class", "annotation").attr("x", iw + 8).attr("y", countryY + 4).attr("text-anchor", "start").attr("fill", COLORS.riskDeep).text(country.country);
}

function updateCountryProfile() {
  const country = selectedCountry();
  const rec = selectedRecord();
  const whoExceed = valueWithFallback("pm25_who_exceed_pct");
  const trend = country.absoluteChange == null ? "has incomplete trend data" : country.absoluteChange < 0 ? "improved" : country.absoluteChange > 0 ? "worsened" : "held steady";
  d3.select("#country-profile").html(`
    <h4>${country.country}</h4>
    <div class="profile-tags">
      <span>${country.region}</span>
      <span>${country.income_group}</span>
      <span>${state.selectedYear}</span>
    </div>
    <div class="profile-grid">
      ${profileStat("PM2.5", fmt(rec?.pm25_mean, " ug/m3"))}
      ${profileStat(whoExceed?.fallback ? `WHO exceedance (${whoExceed.year})` : "WHO exceedance", fmtPct(whoExceed?.value))}
      ${profileStat("CO2 per capita", fmt(rec?.co2_per_capita, " t"))}
      ${profileStat("Life expectancy", fmt(rec?.life_expectancy, " yrs"))}
    </div>
    <p>
      Since ${country.startYear || "the first observed year"}, PM2.5 exposure ${trend}
      ${country.absoluteChange == null ? "" : `by <strong>${Math.abs(country.absoluteChange).toFixed(2)} ug/m3</strong>`}.
      The profile combines pollution exposure, development, energy access, emissions, and health context.
    </p>
    <table>
      <thead><tr><th>Indicator</th><th>Selected year value</th></tr></thead>
      <tbody>
        ${profileRow("GDP per capita", fmtMoney(rec?.gdp_per_capita_2015usd))}
        ${profileRow("Urban population", fmtPct(rec?.urban_population_pct))}
        ${profileRow("Population density", fmt(rec?.population_density, " people/km2"))}
        ${profileRow("Clean cooking access", fmtPct(rec?.clean_cooking_access_pct))}
        ${profileRow("Electricity fossil share", fmtPct(rec?.electricity_fossil_pct))}
        ${profileRow("Renewable electricity share", fmtPct(rec?.electricity_renewable_pct))}
        ${profileRow("Air-pollution mortality", fmt(rec?.air_mortality_total, " /100k"))}
        ${profileRow("GHG per capita", fmt(rec?.ghg_per_capita, " t"))}
      </tbody>
    </table>
  `);
}

function profileStat(label, value) {
  return `<div class="profile-stat"><strong>${value || "No data"}</strong><span>${label}</span></div>`;
}

function profileRow(label, value) {
  return `<tr><td>${label}</td><td>${value || "No data"}</td></tr>`;
}

function prepSvg(selector, height) {
  const root = d3.select(selector);
  const width = root.node().getBoundingClientRect().width || 640;
  root.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  return { root, width, height };
}

function drawEmpty(svg, width, height, message) {
  svg
    .append("text")
    .attr("class", "empty-state")
    .attr("x", width / 2)
    .attr("y", height / 2)
    .attr("text-anchor", "middle")
    .text(message);
}

function axisLabel(root, x, y, text, rotate = 0) {
  root
    .append("text")
    .attr("class", "axis-label")
    .attr("x", x)
    .attr("y", y)
    .attr("text-anchor", "middle")
    .attr("transform", rotate ? `rotate(${rotate},${x},${y})` : null)
    .text(text);
}

function drawIncomeLegend(root, x, y) {
  const legend = root.append("g").attr("transform", `translate(${x},${y})`);
  INCOME_ORDER.filter((d) => d !== "Not classified").forEach((label, index) => {
    const item = legend.append("g").attr("transform", `translate(${index * 118},0)`);
    item.append("circle").attr("r", 5).attr("fill", incomeColor(label));
    item.append("text").attr("class", "legend-label").attr("x", 9).attr("y", 4).text(shortIncome(label));
  });
}

function shortIncome(label) {
  return label.replace(" middle", " mid.").replace(" income", "");
}

function fmt(value, suffix = "") {
  if (value == null || Number.isNaN(value)) return "No data";
  const number = Math.abs(value) >= 1000 ? d3.format(",.0f")(value) : d3.format(".2f")(value);
  return `${number}${suffix}`;
}

function fmtPct(value) {
  if (value == null || Number.isNaN(value)) return "No data";
  return `${d3.format(".1f")(value)}%`;
}

function fmtMoney(value) {
  if (value == null || Number.isNaN(value)) return "No data";
  return `$${d3.format(",.0f")(value)}`;
}

function showTooltip(event, html) {
  tooltip.html(html).attr("hidden", null);
  const pad = 16;
  const rect = tooltip.node().getBoundingClientRect();
  const x = Math.min(event.clientX + pad, window.innerWidth - rect.width - pad);
  const y = Math.min(event.clientY + pad, window.innerHeight - rect.height - pad);
  tooltip.style("left", `${x}px`).style("top", `${y}px`);
}

function hideTooltip() {
  tooltip.attr("hidden", true);
}

function togglePlay() {
  state.isPlaying = !state.isPlaying;
  d3.select("#play-button").text(state.isPlaying ? "Pause" : "Play years");
  if (!state.isPlaying) {
    clearInterval(state.playTimer);
    return;
  }
  state.playTimer = setInterval(() => {
    const years = state.data.metadata.years;
    const index = years.indexOf(state.selectedYear);
    state.selectedYear = years[(index + 1) % years.length];
    updateDashboard();
  }, 950);
}

function resetView() {
  state.selectedRegion = "all";
  state.selectedIncome = "all";
  state.selectedYear = state.data.metadata.latestYear;
  if (state.zoomBehavior) {
    d3.select("#map-chart").transition().duration(300).call(state.zoomBehavior.transform, d3.zoomIdentity);
  }
  updateDashboard();
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
