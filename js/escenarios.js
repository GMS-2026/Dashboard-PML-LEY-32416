'use strict';

const ESC_DATA_URL = 'data/puentes.json';
const ESC_FEM_URL = 'data/emergencia_ds124_2026_cui.json';
const ESC_NS = 'http://www.w3.org/2000/svg';

const state = {
  all: [],
  eligible: [],
  scenario: [],
  femMap: new Map(),
  femLoaded: false,
  canonAvailable: false,
  canonByPliego: new Map(),
  rule: 'todos',
  fem: false,
  noCanon: false,
  budget: 0,
  search: '',
  mapView: 'region',
  scopeRegion: '',
  scopeProvince: '',
  scopeDistrict: '',
  canonAssist: false,
  canonAssistMode: 'percent',
  canonAssistValue: 100,
  mapReady: false,
  mapPaths: new Map(),
  mapFeatureMeta: new Map(),
  districtCenters: new Map(),
  districtLabels: new Map(),
  provinceLabels: new Map(),
  regionLabels: new Map(),
  groupDistricts: { region: new Map(), province: new Map(), district: new Map() },
  viewport: { x: 0, y: 0, w: 600, h: 640 },
  defaultViewport: null,
  pointerStart: null,
  summaryCache: { district: [], province: [], region: [] },
  summaryMapCache: { district: new Map(), province: new Map(), region: new Map() }
};

const $ = id => document.getElementById(id);
const fmtInt = number => Number(number || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 });
const fmtFull = number => `S/ ${Number(number || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCompact = number => {
  const n = Number(number || 0);
  return Math.abs(n) >= 1e6 ? `S/ ${(n / 1e6).toLocaleString('es-PE', { maximumFractionDigits: 2 })} M`
    : Math.abs(n) >= 1e3 ? `S/ ${(n / 1e3).toLocaleString('es-PE', { maximumFractionDigits: 1 })} mil`
    : fmtFull(n);
};
const nval = v => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const x = Number(String(v).replace(/\s/g, '').replace(/,/g, ''));
  return Number.isFinite(x) ? x : 0;
};
const text = v => String(v ?? '').trim();
const upper = v => text(v).toLocaleUpperCase('es-PE');
const normalizeCode = (value, n = 6) => {
  const s = text(value).replace(/\.0+$/, '');
  return s ? s.padStart(n, '0') : '';
};
const keyCui = v => text(v).replace(/\.0$/, '');
const keyPliego = v => upper(v).replace(/\s+/g, ' ');
const esc = v => text(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const first = (row, fields) => fields.map(k => row[k]).find(v => v !== undefined && v !== null && text(v) !== '');

function rowDeficit(row) { return nval(first(row, ['deficit', 'DEFICIT', 'DÉFICIT'])); }
function rowCost(row) { return nval(first(row, ['costo_actualizado', 'COSTO ACTUALIZADO'])); }
function rowCanon(row) {
  const x = first(row, ['CANON', 'canon', 'canon_pliego', 'CANON PLIEGO', 'monto_canon', 'canon_monto', 'canon_asignado', 'monto_canon_pliego', 'CANON_REGISTRADO']);
  return x == null ? null : nval(x);
}
function rowBridges(row) { return nval(first(row, ['n_puentes', 'N_PUENTES', 'puentes'])); }
function boolSiNo(v) {
  const s = upper(v);
  return s === 'SI' || s === 'SÍ' || s === '1' || s === 'TRUE';
}
function setVal(id, value) { const el = $(id); if (el) el.textContent = value; }
function sum(rows, field) { return rows.reduce((acc, row) => acc + (row[field] || 0), 0); }
function uniq(rows, field) { return new Set(rows.map(r => r[field]).filter(Boolean)).size; }

function prepareData(records, femEntries) {
  const femMap = new Map(femEntries.map(x => [keyCui(x.cui), x]));
  state.femMap = femMap;
  state.femLoaded = femEntries.length > 0;
  state.districtLabels.clear(); state.provinceLabels.clear(); state.regionLabels.clear();

  state.all = records.map(raw => {
    const cui = keyCui(raw.cui);
    const fem = femMap.get(cui);
    const regionCode = normalizeCode(raw.ubigeo_departamento, 2);
    const provinceCode = normalizeCode(raw.ubigeo_provincia, 4) || (normalizeCode(raw.ubigeo_distrito, 6).slice(0, 4));
    const districtCode = normalizeCode(raw.ubigeo_distrito, 6);
    const region = upper(raw.region || raw.departamento || 'SIN REGIÓN');
    const province = text(raw.provincia || 'SIN PROVINCIA');
    const district = text(raw.distrito || 'SIN DISTRITO');
    if (districtCode) state.districtLabels.set(districtCode, district);
    if (provinceCode) state.provinceLabels.set(provinceCode, province);
    if (regionCode) state.regionLabels.set(regionCode, region);
    return {
      ...raw,
      _cui: cui,
      _region: region,
      _province: province,
      _district: district,
      _regionCode: regionCode,
      _provinceCode: provinceCode,
      _districtCode: districtCode,
      _pliego: keyPliego(raw.pliego),
      _pliegoDisplay: text(raw.pliego),
      _deficit: rowDeficit(raw),
      _cost: rowCost(raw),
      _canonRaw: rowCanon(raw),
      _bridges: rowBridges(raw),
      _fem: upper(raw.en_emergencia_ds124_2026 || fem?.fem || '') === 'SI' ? 'SI' : upper(raw.en_emergencia_ds124_2026 || fem?.fem || '') === 'NO' ? 'NO' : 'SIN VERIFICAR',
      _femNum: fem?.anexo_item ?? '',
      _femPage: fem?.pagina ?? ''
    };
  });

  state.eligible = state.all.filter(r => r._deficit > 0);

  const byPliego = new Map();
  state.all.forEach(r => {
    if (!r._pliego) return;
    if (!byPliego.has(r._pliego)) byPliego.set(r._pliego, { positiveValues: [], rawValues: [] });
    const bucket = byPliego.get(r._pliego);
    if (r._canonRaw !== null) {
      bucket.rawValues.push(r._canonRaw);
      if (r._canonRaw > 0) bucket.positiveValues.push(r._canonRaw);
    }
  });
  state.canonByPliego = byPliego;
  state.canonAvailable = [...byPliego.values()].some(v => v.rawValues.length > 0);

  if (!state.canonAvailable) {
    $('filterNoCanon').disabled = true;
    $('assistCanon').disabled = true;
    $('canonAssistMode').disabled = true;
    $('canonAssistValue').disabled = true;
    $('canonNotice').hidden = false;
    $('canonNotice').textContent = 'No se detectaron campos de canon en el JSON cargado. Para activar esta lógica, incorpora una columna como CANON, canon_pliego o monto_canon_pliego a nivel de pliego.';
  }
  if (!state.femLoaded) {
    $('filterFem').disabled = true;
  }

  setVal('baseTotal', fmtInt(state.all.length));
  setVal('baseExcluded', fmtInt(state.all.length - state.eligible.length));
  setVal('baseEligible', fmtInt(state.eligible.length));
  setVal('baseDeficit', fmtCompact(sum(state.eligible, '_deficit')));
}

function canonAmountForPliego(pliegoKey) {
  const rec = state.canonByPliego.get(pliegoKey);
  if (!rec || !rec.rawValues.length) return null;
  if (rec.positiveValues.length) return Math.max(...rec.positiveValues);
  return Math.max(...rec.rawValues, 0);
}
function canonStatus(row) {
  const amount = canonAmountForPliego(row._pliego);
  if (amount == null) return 'SIN DATO';
  return amount > 0 ? 'CON CANON' : 'SIN CANON';
}
function isNoCanon(row) {
  const amount = canonAmountForPliego(row._pliego);
  return !amount || amount <= 0;
}
function effectiveCanonBudget(pliegoKey) {
  const base = canonAmountForPliego(pliegoKey) || 0;
  if (!state.canonAssist || !base) return 0;
  const val = Math.max(0, nval(state.canonAssistValue));
  return state.canonAssistMode === 'amount' ? Math.min(base, val) : base * Math.min(val, 100) / 100;
}

function chooseOne(rows, keyGetter, largest = false) {
  const groups = new Map();
  const sorted = rows.slice().sort((a, b) => (largest ? b._deficit - a._deficit : a._deficit - b._deficit) || a._cui.localeCompare(b._cui));
  for (const row of sorted) {
    const key = keyGetter(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, row);
  }
  return [...groups.values()];
}

function ruleOrderedRows(rows) {
  const asc = state.rule !== 'pliego_max' && state.rule !== 'provincia_max';
  return rows.slice().sort((a, b) => (asc ? a._deficit - b._deficit : b._deficit - a._deficit) || a._cui.localeCompare(b._cui));
}

function applyCanonAllocation(rows) {
  const clones = rows.map(r => ({ ...r, _canonApplied: 0, _deficitNet: r._deficit }));
  const groups = new Map();
  clones.forEach(r => {
    if (!groups.has(r._pliego)) groups.set(r._pliego, []);
    groups.get(r._pliego).push(r);
  });
  for (const [pliego, items] of groups) {
    let remainingCanon = effectiveCanonBudget(pliego);
    if (remainingCanon <= 0) continue;
    const ordered = items.slice().sort((a, b) => ((state.rule === 'pliego_max' || state.rule === 'provincia_max') ? b._deficit - a._deficit : a._deficit - b._deficit) || a._cui.localeCompare(b._cui));
    for (const row of ordered) {
      if (remainingCanon <= 0) break;
      const applied = Math.min(remainingCanon, row._deficitNet);
      row._canonApplied = applied;
      row._deficitNet = Math.max(0, row._deficitNet - applied);
      remainingCanon -= applied;
    }
  }
  return clones;
}

function selectScenario(candidates) {
  let rows = candidates.slice();
  if (state.rule === 'pliego_min' || state.rule === 'pliego_max') rows = chooseOne(rows, r => r._pliego, state.rule === 'pliego_max');
  if (state.rule === 'provincia_min' || state.rule === 'provincia_max') rows = chooseOne(rows, r => r._provinceCode || `${r._region}|${upper(r._province)}`, state.rule === 'provincia_max');

  if (state.budget > 0) {
    const preAllocated = applyCanonAllocation(rows);
    const ordered = preAllocated.slice().sort((a, b) => {
      const left = a._deficitNet;
      const right = b._deficitNet;
      return ((state.rule === 'pliego_max' || state.rule === 'provincia_max') ? right - left : left - right) || a._cui.localeCompare(b._cui);
    });
    let remaining = state.budget;
    const selectedCuIs = new Set();
    for (const row of ordered) {
      if (row._deficitNet <= remaining + 1e-6) {
        selectedCuIs.add(row._cui);
        remaining -= row._deficitNet;
      }
    }
    rows = rows.filter(r => selectedCuIs.has(r._cui));
  }
  return applyCanonAllocation(rows).sort((a, b) => b._deficitNet - a._deficitNet || b._deficit - a._deficit || a._cui.localeCompare(b._cui));
}

function eligibleCondition(row) {
  return (!state.fem || row._fem === 'SI') && (!state.noCanon || isNoCanon(row));
}
function rowInScope(row) {
  if (state.scopeDistrict) return row._districtCode === state.scopeDistrict;
  if (state.scopeProvince) return row._provinceCode === state.scopeProvince;
  if (state.scopeRegion) return row._regionCode === state.scopeRegion;
  return true;
}

function simulate() {
  const candidates = state.eligible.filter(r => rowInScope(r) && eligibleCondition(r));
  state.scenario = selectScenario(candidates);
  renderAll();
}

const escCountAnimations = new Map();
function animateMetric(id, value, formatter) {
  const el = $(id);
  if (!el) return;
  const previous = Number(el.dataset.numericValue || 0);
  const target = Number(value || 0);
  el.dataset.numericValue = String(target);
  const oldAnimation = escCountAnimations.get(id);
  if (oldAnimation) cancelAnimationFrame(oldAnimation);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(target - previous) < .001) {
    el.textContent = formatter(target); return;
  }
  const duration = 520;
  const start = performance.now();
  function frame(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatter(previous + (target - previous) * eased);
    if (progress < 1) escCountAnimations.set(id, requestAnimationFrame(frame));
    else { el.textContent = formatter(target); escCountAnimations.delete(id); }
  }
  escCountAnimations.set(id, requestAnimationFrame(frame));
}
function animateMetricCards() {
  for (const card of document.querySelectorAll('.esc-sim-metrics .esc-metric')) {
    card.classList.remove('is-updating');
    void card.offsetWidth;
    card.classList.add('is-updating');
  }
}
function renderMetrics() {
  const rows = state.scenario;
  const total = state.eligible.length;
  animateMetric('metricCount', rows.length, fmtInt);
  setVal('metricPct', `${total ? Math.round(rows.length / total * 100) : 0}% del universo con déficit`);
  animateMetric('metricBridges', sum(rows, '_bridges'), fmtInt);
  animateMetric('metricCost', sum(rows, '_cost'), fmtCompact);
  animateMetric('metricDeficitNet', sum(rows, '_deficitNet'), fmtCompact);
  setVal('metricGap', state.canonAssist ? `Canon considerado: ${fmtCompact(sum(rows, '_canonApplied'))} · Déficit original: ${fmtCompact(sum(rows, '_deficit'))}` : 'Déficit financiero original · Sin canon descontado');
  animateMetricCards();
}

function summaryName(mode, row) {
  if (mode === 'district') return row._district || state.districtLabels.get(row._districtCode) || row._districtCode;
  if (mode === 'province') return row._province || state.provinceLabels.get(row._provinceCode) || row._provinceCode;
  return row._region || state.regionLabels.get(row._regionCode) || row._regionCode;
}
function summaryParent(mode, row) {
  if (mode === 'district') return `${row._province} · ${row._region}`;
  if (mode === 'province') return row._region;
  return `${uniq([row], '_provinceCode')} provincia(s)`;
}
function summaryKey(mode, row) {
  return mode === 'district' ? row._districtCode : mode === 'province' ? row._provinceCode : row._regionCode;
}

function buildSummary(mode, rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = summaryKey(mode, row);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: summaryName(mode, row),
        parent: mode === 'district' ? `${row._province} · ${row._region}` : mode === 'province' ? row._region : `${row._region}`,
        n: 0,
        bridges: 0,
        deficitGross: 0,
        deficitNet: 0,
        cost: 0,
        districts: new Set(),
        provinces: new Set(),
        regions: new Set()
      });
    }
    const g = groups.get(key);
    g.n += 1;
    g.bridges += row._bridges;
    g.deficitGross += row._deficit;
    g.deficitNet += row._deficitNet;
    g.cost += row._cost;
    if (row._districtCode) g.districts.add(row._districtCode);
    if (row._provinceCode) g.provinces.add(row._provinceCode);
    if (row._regionCode) g.regions.add(row._regionCode);
  }
  return [...groups.values()].sort((a, b) => b.n - a.n || b.deficitNet - a.deficitNet || a.name.localeCompare(b.name));
}

function renderTerritoryPanel() {
  const districtSummary = buildSummary('district', state.scenario);
  const provinceSummary = buildSummary('province', state.scenario);
  const regionSummary = buildSummary('region', state.scenario);
  state.summaryCache = { district: districtSummary, province: provinceSummary, region: regionSummary };
  state.summaryMapCache = {
    district: new Map(districtSummary.map(x => [x.key, x])),
    province: new Map(provinceSummary.map(x => [x.key, x])),
    region: new Map(regionSummary.map(x => [x.key, x]))
  };

  setVal('viewCountDistrict', fmtInt(districtSummary.length));
  setVal('viewCountProvince', fmtInt(provinceSummary.length));
  setVal('viewCountRegion', fmtInt(regionSummary.length));

  document.querySelectorAll('[data-map-view]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.mapView === state.mapView));

  const summary = state.summaryCache[state.mapView];
  const currentLabels = {
    district: ['DISTRITO', 'Distritos', 'Distribución distrital del escenario', 'Se listan los distritos que concentran inversiones seleccionadas.'],
    province: ['PROVINCIA', 'Provincias', 'Distribución provincial del escenario', 'Se listan las provincias que concentran inversiones seleccionadas.'],
    region: ['REGIÓN', 'Regiones', 'Distribución regional del escenario', 'Se listan las regiones que concentran inversiones seleccionadas.']
  }[state.mapView];

  setVal('territoryPanelTitle', currentLabels[2]);
  setVal('territoryPanelHelper', currentLabels[3]);
  setVal('territoryCounter', `${fmtInt(summary.length)} ${currentLabels[1].toLowerCase()}`);
  $('territoryColumns').innerHTML = `<span>${currentLabels[0]}</span><span>IOARR</span><span>DÉFICIT</span><span>COSTO</span>`;

  const max = Math.max(1, ...summary.map(x => x.n));
  $('territoryList').innerHTML = summary.length ? summary.map(item => {
    const current = state.mapView === 'district' ? state.scopeDistrict === item.key : state.mapView === 'province' ? state.scopeProvince === item.key : state.scopeRegion === item.key;
    return `<button type="button" class="esc-region-item ${current ? 'is-current' : ''}" data-scope-key="${esc(item.key)}" data-scope-mode="${state.mapView}">
      <span class="esc-region-main"><b>${esc(item.name)}</b><small>${esc(item.parent)}</small></span>
      <span class="esc-region-count">${fmtInt(item.n)}</span>
      <span class="esc-region-deficit">${fmtCompact(item.deficitNet)}</span>
      <span class="esc-region-cost">${fmtCompact(item.cost)}</span>
      <span class="esc-region-bar"><span style="--e-bar-value:${Math.round(item.n / max * 100)}%"></span></span>
    </button>`;
  }).join('') : '<div class="esc-note">No se registran inversiones para la combinación seleccionada.</div>';

  $('territoryList').querySelectorAll('[data-scope-key]').forEach(btn => btn.addEventListener('click', () => {
    applyScope(btn.dataset.scopeMode, btn.dataset.scopeKey, true);
  }));

  requestAnimationFrame(() => { $('territoryList').querySelectorAll('.esc-region-bar span').forEach(bar => bar.classList.add('is-measured')); });

  setVal('selectedScope', currentScopeLabel());
  setVal('selectedScopeDeficit', fmtCompact(sum(state.scenario, '_deficitNet')));
}

function currentScopeLabel() {
  if (state.scopeDistrict) return `${state.districtLabels.get(state.scopeDistrict) || state.scopeDistrict} · Distrito`;
  if (state.scopeProvince) return `${state.provinceLabels.get(state.scopeProvince) || state.scopeProvince} · Provincia`;
  if (state.scopeRegion) return `${state.regionLabels.get(state.scopeRegion) || state.scopeRegion} · Región`;
  return 'Perú · Todo el ámbito';
}

function renderDetail() {
  const search = upper(state.search);
  const rows = state.scenario.filter(r => !search || r._cui.includes(search) || r._pliego.includes(search) || upper(r._district).includes(search) || upper(r._province).includes(search) || upper(r._region).includes(search));
  setVal('detailCount', `${fmtInt(rows.length)} inversión(es) visibles de ${fmtInt(state.scenario.length)} seleccionadas`);
  const display = rows.slice(0, 700);
  $('detailBody').innerHTML = display.length ? display.map(r => `
    <tr>
      <td>${esc(r._cui)}</td>
      <td>${esc(r.denominacion_inversion || 'Inversión sin denominación')}<small>${esc(r._pliegoDisplay)}</small></td>
      <td>${esc(r._region)} · ${esc(r._province)} · ${esc(r._district)}</td>
      <td><span class="esc-status ${r._fem === 'SI' ? '' : 'no'}">${r._fem === 'SI' ? 'Sí' : r._fem === 'NO' ? 'No' : 'Pendiente'}</span></td>
      <td>${fmtFull(r._canonApplied || 0)}</td>
      <td>${fmtFull(r._cost)}</td>
      <td>${fmtFull(r._deficit)}</td>
      <td>${fmtFull(r._deficitNet)}</td>
    </tr>
  `).join('') : '<tr><td colspan="8">No hay inversiones para los criterios seleccionados.</td></tr>';
  setVal('detailFooter', `Se visualizan ${fmtInt(display.length)} de ${fmtInt(rows.length)} filas. La exportación descarga todas las inversiones seleccionadas.`);
}

function renderAll() {
  renderMetrics();
  renderTerritoryPanel();
  renderDetail();
  updateMap();
}

function applyScope(mode, key, rerun = true) {
  const prevRegion = state.scopeRegion;
  const prevProvince = state.scopeProvince;
  const prevDistrict = state.scopeDistrict;
  state.scopeRegion = '';
  state.scopeProvince = '';
  state.scopeDistrict = '';
  if (mode === 'region') state.scopeRegion = prevRegion === key ? '' : key;
  if (mode === 'province') state.scopeProvince = prevProvince === key ? '' : key;
  if (mode === 'district') state.scopeDistrict = prevDistrict === key ? '' : key;
  if (rerun) { simulate(); focusMapToScope(); }
}

function clearScopes() {
  state.scopeRegion = ''; state.scopeProvince = ''; state.scopeDistrict = '';
}

// Importes en soles: agrupación de miles visible sin alterar los importes numéricos.
function parseMoneyInput(value) {
  let s = text(value).replace(/[^0-9.,]/g, '');
  if (!s) return 0;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const sep = lastDot > lastComma ? '.' : ',';
    s = sep === '.' ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    const tail = s.slice(lastComma + 1);
    s = tail.length && tail.length <= 2 && s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) || []).length > 1 || (lastDot > 0 && s.length - lastDot - 1 === 3)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function formatMoneyInput(input) {
  const raw = text(input.value);
  input.value = raw ? parseMoneyInput(raw).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
}
function refreshBudgetUi() {
  const btn = $('clearBudget');
  btn.classList.toggle('is-free', !state.budget);
  btn.innerHTML = state.budget ? '<i class="bi bi-unlock"></i> Quitar techo financiero' : '<i class="bi bi-check-circle-fill"></i> Sin límite financiero activo';
}

function refreshCanonHelp() {
  const percentMode = state.canonAssistMode === 'percent';
  const val = Math.max(0, nval(state.canonAssistValue));
  setVal('canonAssistHelp', percentMode
    ? 'Se calcula sobre el CANON registrado del pliego, no sobre el costo ni el déficit de cada CUI.'
    : 'Monto máximo de canon que se considera para cada pliego (sin duplicarlo por CUI).');
  setVal('canonFormula', percentMode
    ? `Ejemplo: canon S/ 500,000 × ${Math.min(100, val)} % = ${fmtFull(500000 * Math.min(100, val) / 100)} considerados.`
    : `Tope considerado por pliego: ${fmtFull(val)} o su canon registrado, el que sea menor.`);
}

function setupControls() {
  document.querySelectorAll('input[name="selRule"]').forEach(input => input.addEventListener('change', () => { state.rule = input.value; simulate(); }));
  $('filterFem').addEventListener('change', e => { state.fem = e.target.checked; simulate(); });
  $('filterNoCanon').addEventListener('change', e => { state.noCanon = e.target.checked; simulate(); });

  $('assistCanon').addEventListener('change', e => {
    state.canonAssist = e.target.checked;
    $('canonAssistMode').disabled = !state.canonAvailable || !state.canonAssist;
    $('canonAssistValue').disabled = !state.canonAvailable || !state.canonAssist;
    simulate();
  });
  $('canonAssistMode').addEventListener('change', e => {
    state.canonAssistMode = e.target.value;
    $('canonAssistUnit').textContent = state.canonAssistMode === 'amount' ? 'S/' : '%';
    $('canonAssistValue').value = state.canonAssistMode === 'amount' ? '0' : '100';
    state.canonAssistValue = parseMoneyInput($('canonAssistValue').value);
    refreshCanonHelp();
    simulate();
  });
  $('canonAssistValue').addEventListener('change', e => { state.canonAssistValue = parseMoneyInput(e.target.value); if (state.canonAssistMode === 'percent') state.canonAssistValue = Math.min(100, state.canonAssistValue); formatMoneyInput(e.target); refreshCanonHelp(); simulate(); });

  $('budgetInput').addEventListener('change', e => { state.budget = parseMoneyInput(e.target.value); formatMoneyInput(e.target); refreshBudgetUi(); simulate(); });
  $('clearBudget').addEventListener('click', () => { $('budgetInput').value = ''; state.budget = 0; refreshBudgetUi(); simulate(); });
  refreshBudgetUi();
  refreshCanonHelp();

  $('resetEsc').addEventListener('click', () => {
    state.rule = 'todos'; state.fem = false; state.noCanon = false; state.budget = 0; state.search = '';
    state.mapView = 'region'; state.canonAssist = false; state.canonAssistMode = 'percent'; state.canonAssistValue = 100;
    clearScopes();
    document.querySelector('input[name="selRule"][value="todos"]').checked = true;
    $('filterFem').checked = false; $('filterNoCanon').checked = false; $('budgetInput').value = '';
    $('detailSearch').value = ''; $('assistCanon').checked = false; $('canonAssistMode').value = 'percent'; $('canonAssistValue').value = '100'; $('canonAssistUnit').textContent = '%';
    $('canonAssistMode').disabled = !state.canonAvailable; $('canonAssistValue').disabled = !state.canonAvailable;
    refreshBudgetUi(); refreshCanonHelp(); simulate(); activateMapView('region');
  });

  $('detailSearch').addEventListener('input', e => { state.search = e.target.value; renderDetail(); });
  $('exportExcel').addEventListener('click', exportExcel);

  $('clearScope').addEventListener('click', () => { clearScopes(); simulate(); focusMapToScope(); });
  document.querySelectorAll('[data-map-view]').forEach(btn => btn.addEventListener('click', () => {
    state.mapView = btn.dataset.mapView;
    renderTerritoryPanel();
    activateMapView(state.mapView);
  }));

  $('mapZoomIn').addEventListener('click', () => zoomMap(.77));
  $('mapZoomOut').addEventListener('click', () => zoomMap(1.3));
  $('mapZoomReset').addEventListener('click', () => { if (state.defaultViewport) { state.viewport = { ...state.defaultViewport }; applyViewport(); } });
}

function scenarioCriteria() {
  const names = {
    todos: 'Sin reducción adicional',
    pliego_min: 'Una inversión por pliego: menor déficit',
    pliego_max: 'Una inversión por pliego: mayor déficit',
    provincia_min: 'Una inversión por provincia: menor déficit',
    provincia_max: 'Una inversión por provincia: mayor déficit'
  };
  return [
    ['Regla de selección', names[state.rule] || state.rule],
    ['Zona El Niño (D. S. N.° 124-2026-PCM)', state.fem ? 'Solo distritos declarados' : 'Sin restricción'],
    ['Canon - exclusión', state.noCanon ? 'Solo pliegos sin canon positivo' : 'Sin exclusión por canon'],
    ['Canon - cobertura', state.canonAssist ? (state.canonAssistMode === 'percent' ? `${state.canonAssistValue}% del canon del pliego` : `Hasta ${fmtFull(state.canonAssistValue)} del canon por pliego`) : 'No aplicada'],
    ['Techo financiero total', state.budget > 0 ? fmtFull(state.budget) : 'Sin límite financiero'],
    ['Ámbito geográfico', currentScopeLabel()],
    ['Universo elegible', `${fmtInt(state.eligible.length)} IOARR con déficit positivo`],
    ['Inversiones seleccionadas', `${fmtInt(state.scenario.length)} IOARR`],
    ['Búsqueda en la tabla', state.search || 'Sin búsqueda adicional'],
    ['Costo actualizado seleccionado', fmtFull(sum(state.scenario, '_cost'))],
    ['Déficit original seleccionado', fmtFull(sum(state.scenario, '_deficit'))],
    ['Canon considerado', fmtFull(sum(state.scenario, '_canonApplied'))],
    ['Brecha final por financiar', fmtFull(sum(state.scenario, '_deficitNet'))]
  ];
}
function exportExcel() {
  if (!window.ESCExcel?.download) {
    console.error('No se cargó el componente de exportación Excel.');
    alert('No se encuentra disponible la exportación a Excel. Comprueba que js/escenarios_excel.js esté instalado.');
    return;
  }
  const columns = ['CUI', 'Departamento', 'Provincia', 'Distrito', 'UBIGEO', 'Pliego', 'Nombre de la inversión', 'Puentes', 'Costo actualizado (S/)', 'Déficit inicial (S/)', 'Canon aplicado (S/)', 'Brecha por financiar (S/)', 'Zona El Niño', 'Registro anexo PCM', 'Canon del pliego (S/)'];
  const query = upper(state.search);
  const visibleRows = state.scenario.filter(r => !query || r._cui.includes(query) || r._pliego.includes(query) || upper(r._district).includes(query) || upper(r._province).includes(query) || upper(r._region).includes(query));
  const records = visibleRows.map(r => [r._cui, r._region, r._province, r._district, r._districtCode, r._pliegoDisplay, r.denominacion_inversion || '', r._bridges, r._cost, r._deficit, r._canonApplied, r._deficitNet, r._fem, r._femNum, canonAmountForPliego(r._pliego)]);
  const file = `alternativas_atencion_ley32416_${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    window.ESCExcel.download({ filename: file, title: 'Ley N.° 32416 - Evaluación de alternativas de atención', criteria: scenarioCriteria(), columns, records, moneyColumns: [8,9,10,11,14], integerColumns: [7] });
  } catch (error) {
    console.error('Error al exportar Excel:', error);
    alert('No fue posible crear el archivo Excel. Revisa la consola del navegador para más detalles.');
  }
}

/* MAPA MULTIESCALA
 * Cada escala tiene una capa GeoJSON propia. Nunca se aproxima una región
 * rellenando cientos de polígonos distritales ni se etiquetan 131 provincias.
 * Los filtros de cartera solo actualizan clases/valores; no vuelven a dibujar geometrías.
 */
const ESC_MAP_URLS = {
  region: 'https://raw.githubusercontent.com/Rodasluis/Peru-maps/main/salida/departamento_simplificado.geojson',
  province: 'https://raw.githubusercontent.com/Rodasluis/Peru-maps/main/salida/provincia_simplificado.geojson',
  district: 'https://raw.githubusercontent.com/Rodasluis/Peru-maps/main/salida/distrito_simplificado.geojson'
};
const escGeoCache = { region: null, province: null, district: null };
const escLayerCache = new Map();
let escGeoBounds = null;
let escMapRequest = 0;
let escFrame = null;
let escMapPanInstalled = false;
const ESC_MAP_W = 600, ESC_MAP_H = 640;

function geoCoords(geometry) {
  const coords = [];
  if (!geometry) return coords;
  const takeRing = ring => ring.forEach(p => { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) coords.push(p); });
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(takeRing);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(poly => poly.forEach(takeRing));
  return coords;
}
function geoProjection(bounds) {
  const spanX = bounds.maxX - bounds.minX, spanY = bounds.maxY - bounds.minY;
  const scale = Math.min((ESC_MAP_W - 35) / spanX, (ESC_MAP_H - 35) / spanY);
  const ox = (ESC_MAP_W - spanX * scale) / 2;
  const oy = (ESC_MAP_H - spanY * scale) / 2;
  return p => [ox + (p[0] - bounds.minX) * scale, oy + (bounds.maxY - p[1]) * scale];
}
function geometryPath(geometry, project) {
  const drawRing = ring => ring.map((p, i) => {
    const [x, y] = project(p);
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join('') + 'Z';
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return geometry.coordinates.map(drawRing).join(' ');
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap(poly => poly.map(drawRing)).join(' ');
  return '';
}
function mapFeatureCode(f, mode) {
  const p = f.properties || {};
  if (mode === 'region') return normalizeCode(p.ubigeo_departamento ?? p.ubigeo ?? p.UBIGEO ?? p.ccdd ?? p.CCDD, 2);
  if (mode === 'province') return normalizeCode(p.ubigeo_provincia ?? p.ubigeo ?? p.UBIGEO ?? (p.ccdd && p.ccpp ? String(p.ccdd) + String(p.ccpp) : null), 4);
  return normalizeCode(p.ubigeo_distrito ?? p.ubigeo ?? p.UBIGEO, 6);
}
function mapFeatureName(f, mode) {
  const p = f.properties || {};
  return text(p.nombre || p.NOMBRE || (mode === 'region' ? p.nombre_departamento : mode === 'province' ? p.nombre_provincia : p.nombre_distrito) || p.nombdist || '');
}
function mapExtent(features) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of features) for (const [x, y] of geoCoords(f.geometry)) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}
function mapLabels(mode) {
  return { region: 'Regional', province: 'Provincial', district: 'Distrital' }[mode];
}
function setMapLoading(loading, message) {
  const el = $('mapLoading');
  el.hidden = !loading;
  if (message) el.innerHTML = `<span class="esc-spinner"></span> ${esc(message)}`;
}
async function requestMapLayer(mode) {
  if (escLayerCache.has(mode)) return escLayerCache.get(mode);
  let features = escGeoCache[mode];
  if (!features) {
    const res = await fetch(ESC_MAP_URLS[mode], { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const geo = await res.json();
    if (!geo || !Array.isArray(geo.features)) throw new Error('GeoJSON no válido');
    features = geo.features;
    escGeoCache[mode] = features;
  }
  if (!escGeoBounds) escGeoBounds = mapExtent(features);
  const project = geoProjection(escGeoBounds);
  const mapLayer = document.createElementNS(ESC_NS, 'g');
  mapLayer.setAttribute('class', 'esc-layer-enter esc-layer-' + mode);
  const paths = new Map();
  const names = new Map();
  const fragment = document.createDocumentFragment();
  for (const feature of features) {
    const key = mapFeatureCode(feature, mode);
    if (!key || !feature.geometry) continue;
    const p = document.createElementNS(ESC_NS, 'path');
    p.setAttribute('d', geometryPath(feature.geometry, project));
    p.setAttribute('class', 'esc-geo-shape');
    p.dataset.code = key;
    const label = mapFeatureName(feature, mode) || key;
    const title = document.createElementNS(ESC_NS, 'title');
    title.textContent = label;
    p.appendChild(title);
    p.addEventListener('pointerenter', e => showGeoTooltip(e, mode, key, label));
    p.addEventListener('pointermove', positionGeoTooltip);
    p.addEventListener('pointerleave', () => { $('mapTooltip').hidden = true; });
    p.addEventListener('click', e => {
      if (state.pointerStart?.moved) return;
      applyScope(mode, key, true);
    });
    paths.set(key, p); names.set(key, label); fragment.appendChild(p);
  }
  mapLayer.appendChild(fragment);
  const cache = { el: mapLayer, paths, names };
  escLayerCache.set(mode, cache);
  return cache;
}
function paintMapNow() {
  if (!state.mapReady) return;
  const mode = state.mapView, layer = escLayerCache.get(mode);
  if (!layer) return;
  const summaries = state.summaryMapCache[mode] || new Map();
  const max = Math.max(1, ...[...summaries.values()].map(x => x.n));
  const scopeKey = currentScopeKeyForMode(mode);
  for (const [code, shape] of layer.paths) {
    const count = summaries.get(code)?.n || 0;
    shape.classList.toggle('is-active', count > 0);
    shape.classList.toggle('is-focus', scopeKey === code);
    shape.style.setProperty('--e-intensity', count > 0 ? String(.34 + .66 * Math.sqrt(count / max)) : '0');
  }
  renderRegionalMarkers();
  $('regionalCounter').hidden = mode !== 'region';
  setVal('viewCountRegion', fmtInt(state.summaryCache.region.length));
  setVal('mapFocus', scopeKey
    ? `${currentScopeLabel()} · ${fmtInt(state.scenario.length)} IOARR · ${fmtCompact(sum(state.scenario, '_deficitNet'))} de brecha residual`
    : `Perú · ${fmtInt(state.summaryCache[mode].length)} ${mode === 'district' ? 'distritos' : mode === 'province' ? 'provincias' : 'regiones'} comprendidos · Selecciona un polígono para analizarlo.`);
}
function updateMap() {
  if (!state.mapReady) return;
  if (escFrame !== null) cancelAnimationFrame(escFrame);
  escFrame = requestAnimationFrame(() => { escFrame = null; paintMapNow(); });
}
function currentScopeKeyForMode(mode) {
  return mode === 'district' ? state.scopeDistrict : mode === 'province' ? state.scopeProvince : state.scopeRegion;
}
function showGeoTooltip(event, mode, code, label) {
  const item = state.summaryMapCache[mode]?.get(code);
  const t = $('mapTooltip');
  t.innerHTML = `<strong>${esc(item?.name || label)}</strong><br>${fmtInt(item?.n || 0)} IOARR en el escenario<br><b>${esc(fmtCompact(item?.deficitNet || 0))}</b> de brecha residual<br>${esc(fmtCompact(item?.cost || 0))} de costo actualizado`;
  t.hidden = false;
  positionGeoTooltip(event);
}
function positionGeoTooltip(event) {
  const wrap = $('priorityMap').parentElement, bounds = wrap.getBoundingClientRect(), tip = $('mapTooltip');
  const w = 250, h = 115;
  tip.style.left = `${Math.max(8, Math.min(event.clientX - bounds.left + 14, bounds.width - w - 10))}px`;
  tip.style.top = `${Math.max(8, Math.min(event.clientY - bounds.top + 16, bounds.height - h - 10))}px`;
}
function renderRegionalMarkers() {
  const badges = $('badgeLayer');
  badges.replaceChildren();
  if (state.mapView !== 'region') return;
  const layer = escLayerCache.get('region');
  if (!layer) return;
  const fragment = document.createDocumentFragment();
  const occupied = [];
  const items = state.summaryCache.region || [];
  for (const item of items) {
    const path = layer.paths.get(item.key);
    if (!path) continue;
    const box = path.getBBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (occupied.some(v => Math.hypot(v.x - x, v.y - y) < 23)) continue;
    occupied.push({ x, y });
    const g = document.createElementNS(ESC_NS, 'g');
    g.setAttribute('class', 'esc-region-marker');
    g.setAttribute('transform', `translate(${x},${y})`);
    g.dataset.code = item.key;
    const circle = document.createElementNS(ESC_NS, 'circle'); circle.setAttribute('r', '13');
    const label = document.createElementNS(ESC_NS, 'text'); label.textContent = String(item.n);
    g.append(circle, label);
    g.addEventListener('click', e => { e.stopPropagation(); applyScope('region', item.key, true); });
    fragment.appendChild(g);
  }
  badges.appendChild(fragment);
}
async function activateMapView(mode) {
  const currentRequest = ++escMapRequest;
  setMapLoading(true, `Cargando vista ${mapLabels(mode).toLowerCase()}…`);
  try {
    const layer = await requestMapLayer(mode);
    if (currentRequest !== escMapRequest) return;
    $('mapLayer').replaceChildren(layer.el);
    layer.el.classList.remove('esc-layer-enter');
    void layer.el.getBoundingClientRect();
    layer.el.classList.add('esc-layer-enter');
    state.mapReady = true;
    state.defaultViewport = { x: 0, y: 0, w: ESC_MAP_W, h: ESC_MAP_H };
    if (!state.viewport) state.viewport = { ...state.defaultViewport };
    setMapLoading(false);
    setVal('mapSubtitle', `Mapa ${MapLabelsText(mode)} · Clic para filtrar por ${mode === 'district' ? 'distrito' : mode === 'province' ? 'provincia' : 'región'}.`);
    document.querySelectorAll('[data-map-view]').forEach(btn => {
      const selected = btn.dataset.mapView === mode;
      btn.classList.toggle('is-active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    updateMap(); focusMapToScope();
    if (!escMapPanInstalled) setupMapPan();
  } catch (err) {
    if (currentRequest !== escMapRequest) return;
    setMapLoading(true, 'No se pudo cargar esta escala cartográfica. Comprueba la conexión; el resto de la evaluación continúa disponible.');
    setVal('mapSubtitle', 'Cartografía no disponible');
    console.warn(`Mapa ${mode}:`, err);
  }
}
function MapLabelsText(mode) { return { region: 'regional', province: 'provincial', district: 'distrital' }[mode]; }
function focusMapToScope() {
  if (!state.mapReady) return;
  const layer = escLayerCache.get(state.mapView);
  if (!layer) return;
  const prefix = state.scopeDistrict || state.scopeProvince || state.scopeRegion;
  if (!prefix) { state.viewport = { ...state.defaultViewport }; applyViewport(); return; }
  // Respeta el ámbito territorial superior al cambiar de región a provincia/distrito.
  const paths = [...layer.paths].filter(([code]) => code.startsWith(prefix)).map(([, shape]) => shape);
  if (!paths.length) { state.viewport = { ...state.defaultViewport }; applyViewport(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  paths.forEach(shape => {
    const b = shape.getBBox();
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
  });
  if (!Number.isFinite(minX)) return;
  const w = Math.min(ESC_MAP_W, Math.max(85, (maxX - minX) * 1.5, (maxY - minY) * 1.5 * ESC_MAP_W / ESC_MAP_H));
  const h = w * ESC_MAP_H / ESC_MAP_W;
  state.viewport = { x: (minX + maxX - w) / 2, y: (minY + maxY - h) / 2, w, h };
  applyViewport();
}

function applyViewport() {
  const v = state.viewport;
  $('priorityMap').setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}
function zoomMap(factor) {
  if (!state.mapReady) return;
  const v = state.viewport, w = Math.max(60, Math.min(1100, v.w * factor)), h = w * ESC_MAP_H / ESC_MAP_W;
  state.viewport = { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
  applyViewport();
}
function setupMapPan() {
  if (escMapPanInstalled) return;
  escMapPanInstalled = true;
  const svg = $('priorityMap');
  svg.addEventListener('pointerdown', e => {
    state.pointerStart = { x: e.clientX, y: e.clientY, v: { ...state.viewport }, moved: false };
  });
  svg.addEventListener('pointermove', e => {
    const p = state.pointerStart;
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) p.moved = true;
    if (!p.moved) return;
    state.viewport = { ...p.v, x: p.v.x - dx / svg.clientWidth * p.v.w, y: p.v.y - dy / svg.clientHeight * p.v.h };
    applyViewport();
  });
  svg.addEventListener('pointerup', () => { if (state.pointerStart) setTimeout(() => state.pointerStart = null, 35); });
  svg.addEventListener('pointerleave', () => { state.pointerStart = null; });
}
async function load() {
  setupControls();
  try {
    const responses = await Promise.all([fetch(ESC_DATA_URL, { cache: 'no-store' }), fetch(ESC_FEM_URL, { cache: 'no-store' })]);
    for (const res of responses) if (!res.ok) throw new Error(`No se pudo leer ${res.url || 'fuente'} (${res.status})`);
    const [records, fem] = await Promise.all(responses.map(r => r.json()));
    if (!Array.isArray(records) || !Array.isArray(fem)) throw new Error('Fuentes JSON inválidas');
    prepareData(records, fem);
    $('canonAssistMode').disabled = !state.canonAvailable;
    $('canonAssistValue').disabled = !state.canonAvailable;
    simulate();
    await activateMapView('region');
  } catch (err) {
    console.error('Escenarios:', err);
    setVal('mapSubtitle', 'Error de carga');
    $('mapLoading').textContent = `No se pudieron leer los datos: ${err.message}. Revisa data/puentes.json y el servidor local.`;
  }
}
window.addEventListener('DOMContentLoaded', load);
