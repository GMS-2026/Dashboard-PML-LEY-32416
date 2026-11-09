'use strict';

const ESC_DATA_URL = 'data/puentes.json';
const ESC_FEM_URL = 'data/emergencia_ds124_2026_cui.json';
const ESC_NATURAL_REGION_URL = 'data/region_natural_ubigeo.json';
const ESC_NS = 'http://www.w3.org/2000/svg';
const ESC_CANAL_CUIS = new Set(['2677338','2675020','2658249']); // Clasificación informada por el usuario; las denominaciones de origen aún refieren puentes.

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
  canonCoverageFilter: 'all',
  coverageEnabled: false,
  coverageMax: 50,
  budgetOrder: 'asc',
  activeView: 'manual',
  recommendation: null,
  recommendScope: 'current',
  comparisonGoal: 'ioarr',
  lastManualRule: 'todos',
  
  costOnlyAlerts: false,
  ioarrCondition: 'all',
  costExclusionMode: 'none',
  costAlertFactor: 2.5,
  costImpact: null,
  naturalRegionByUbigeo: new Map(),
  canonUsePercent: 100,
  comparisonResults: [],
  recommendedRows: [],
  auditRows: [],
  budget: 0,
  search: '',
  mapView: 'region',
  scopeRegion: '',
  scopeProvince: '',
  scopeDistrict: '',
  scopePliego: '',
  territoryGrouping:'map',
  canonAssist: false,
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

function prepareData(records, femEntries, regionsNatural = []) {
  state.naturalRegionByUbigeo = new Map(regionsNatural.filter(x => x && x.ubigeo).map(x => [normalizeCode(x.ubigeo,6), text(x.region_natural)]));
  const femMap = new Map(femEntries.map(x => [keyCui(x.cui), x]));
  state.femMap = femMap;
  state.femLoaded = records.some(r=>['SI','SÍ','NO'].includes(upper(r['DECLARATORIA DE EMERGENCIA PCM']))) || femEntries.length > 0;
  state.districtLabels.clear(); state.provinceLabels.clear(); state.regionLabels.clear();

  state.all = records.map(raw => {
    const cui = keyCui(raw.cui);
    const fem = femMap.get(cui);
    const regionCode = normalizeCode(raw.ubigeo_departamento, 2);
    const provinceCode = normalizeCode(raw.ubigeo_provincia, 4) || (normalizeCode(raw.ubigeo_distrito, 6).slice(0, 4));
    const districtCode = normalizeCode(raw.ubigeo_distrito, 6);
    const region = upper(raw.REGION || raw.region || raw.departamento || 'SIN REGIÓN');
    const province = text(raw.provincia || 'SIN PROVINCIA');
    const district = text(raw.distrito || 'SIN DISTRITO');
    if (districtCode) state.districtLabels.set(districtCode, district);
    if (provinceCode) state.provinceLabels.set(provinceCode, province);
    if (regionCode) state.regionLabels.set(regionCode, region);
    return {
      ...raw,
      denominacion_inversion: raw['DENOMINACION DE LA INVERSION'] || raw.denominacion_inversion || '',
      _cui: cui,
      _region: region,
      _province: province,
      _district: district,
      _regionCode: regionCode,
      _provinceCode: provinceCode,
      _districtCode: districtCode,
      _pliego: `${normalizeCode(raw['UBIGEO UE'],6)}|${keyPliego(raw.pliego)}`,
      _ubigeoUE: normalizeCode(raw['UBIGEO UE'],6),
      _pliegoDisplay: text(raw.pliego),
      _deficit: rowDeficit(raw),
      _cost: rowCost(raw),
      _lengthTotal: nval(first(raw, ['longitud','LONGITUD TOTAL','longitud_total','longitud_total_m'])),
      _regionNatural: naturalRegion(text(first(raw, ['region_natural','REGION NATURAL','region_geografica'])) || state.naturalRegionByUbigeo.get(districtCode)),
      _canonRaw: rowCanon(raw),
      _bridges: rowBridges(raw),
      _isReportedCanal: upper(raw['ES IOARR']) === 'NO' || ESC_CANAL_CUIS.has(cui),
      _fem: upper(raw['DECLARATORIA DE EMERGENCIA PCM'] || raw.en_emergencia_ds124_2026 || fem?.fem || '') === 'SI' ? 'SI' : upper(raw['DECLARATORIA DE EMERGENCIA PCM'] || raw.en_emergencia_ds124_2026 || fem?.fem || '') === 'NO' ? 'NO' : 'SIN VERIFICAR',
      _femNum: fem?.anexo_item ?? '',
      _femPage: fem?.pagina ?? ''
    };
  });

  state.eligible = state.all.filter(r => r._deficit > 0);
  buildCostRiskProfiles();

  const byPliego = new Map();
  state.all.forEach(r => {
    if (!r._pliego) return;
    if (!byPliego.has(r._pliego)) byPliego.set(r._pliego, { positiveValues: [], rawValues: [], deficit: 0 });
    const bucket = byPliego.get(r._pliego);
    if (r._deficit > 0) bucket.deficit += r._deficit;
    if (r._canonRaw !== null) {
      bucket.rawValues.push(r._canonRaw);
      if (r._canonRaw > 0) bucket.positiveValues.push(r._canonRaw);
    }
  });
  state.canonByPliego = byPliego;
  state.canonAvailable = [...byPliego.values()].some(v => v.rawValues.length > 0);

  if (!state.canonAvailable) {
    $('assistCanon').disabled = true;
    $('canonUsePercent').disabled = true;
    $('canonNotice').hidden = false;
    $('canonNotice').textContent = 'No hay datos de canon en esta fuente: para el filtro se consideran 0 %. No puede calcularse descuento de canon hasta cargar los importes del pliego.';
  }
  if (!state.femLoaded) {
    $('filterFem').disabled = true;
  }

  setVal('baseTotal', fmtInt(state.all.length));
  setVal('baseExcluded', fmtInt(state.all.length - state.eligible.length));
  setVal('baseEligible', fmtInt(typeof candidatesNow === 'function' ? candidatesNow().length : state.eligible.length));
  setVal('baseDeficit', fmtCompact(sum(typeof candidatesNow === 'function' ? candidatesNow() : state.eligible, '_deficit')));
}

// Segmentación explícita; una región administrativa NO equivale a costa/sierra/selva.
function naturalRegion(value) {
  const x = upper(value);
  if (x === '1' || x === 'COSTA') return 'COSTA';
  if (x === '2' || x === 'SIERRA') return 'SIERRA';
  if (x === '3' || x === '4' || x.startsWith('SELVA')) return 'SELVA';
  return 'SIN CLASIFICAR';
}
function median(values) {
  const sorted = values.slice().sort((a,b)=>a-b);
  const n=sorted.length;
  return !n?null:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;
}
function costLengthBand(r) {
  const average=r._lengthTotal/Math.max(1,r._bridges);
  return average<=10?'0-10m':average<=20?'10-20m':average<=40?'20-40m':'40m+';
}
function costBridgeBand(r) {return r._bridges===1?'1 puente':r._bridges===2?'2 puentes':'3+ puentes';}
function costKey(r, zone) { return `${zone}|${costBridgeBand(r)}|${costLengthBand(r)}`; }

function buildCostRiskProfiles() {
  // Cada inversión se compara sin incluirse a sí misma. Para grupos pequeños
  // se amplía la referencia dentro de su misma región natural; esos resultados
  // son DESCRIPTIVOS y no producen una alerta de exclusión automática.
  const valid=state.eligible.filter(r=>!r._isReportedCanal && r._lengthTotal>0 && r._bridges>0 && r._cost>0);
  const buckets=new Map();
  for(const r of state.eligible){
    r._costPerMeter=null;r._avgBridgeLength=null;r._costRatio=null;
    r._costFlag=false;r._costProvisionalFlag=false;r._costPeers=0;r._costReference=null;
    r._costDifference=null;r._costDifferencePercent=null;
    r._costReferenceType='';r._costStrictComparable=false;
  }
  for(const r of valid){
    r._avgBridgeLength=r._lengthTotal/r._bridges;
    r._costPerMeter=r._cost/r._lengthTotal;
    const keys=[
      `estricta|${costKey(r,r._regionNatural)}`,
      `luz|${r._regionNatural}|${costLengthBand(r)}`,
      `puentes|${r._regionNatural}|${costBridgeBand(r)}`,
      `zona|${r._regionNatural}`
    ];
    for(const key of keys){if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
  }
  for(const r of valid){
    const keys=[
      ['estricta',`estricta|${costKey(r,r._regionNatural)}`],
      ['luz',`luz|${r._regionNatural}|${costLengthBand(r)}`],
      ['puentes',`puentes|${r._regionNatural}|${costBridgeBand(r)}`],
      ['zona',`zona|${r._regionNatural}`]
    ];
    for(const [type,key] of keys){
      const peers=(buckets.get(key)||[]).filter(x=>x!==r);
      // Usar >=5 para alerta homogénea; como referencia descriptiva, una
      // zona completa de 2 o más casos también puede servir.
      if(peers.length<(type==='zona'?1:5))continue;
      const benchmark=median(peers.map(x=>x._costPerMeter));
      if(!(benchmark>0))continue;
      r._costReference=benchmark;
      r._costRatio=r._costPerMeter/benchmark;
      r._costDifference=r._costPerMeter-benchmark;
      r._costDifferencePercent=(r._costRatio-1)*100;
      r._costPeers=peers.length;
      r._costStrictComparable=type==='estricta';
      r._costReferenceType=type==='estricta'?'PARES DEL MISMO GRUPO':
        type==='luz'?'GRUPO AMPLIADO POR LONGITUD':
        type==='puentes'?'GRUPO AMPLIADO POR CANTIDAD':'REFERENCIA DE LA MISMA ZONA';
      break;
    }
  }
  refreshCostRiskFlags();
}
function refreshCostRiskFlags(){
  for(const r of state.eligible){
    r._costFlag=!!(r._costStrictComparable && r._costRatio!=null && r._costRatio>=state.costAlertFactor);
    r._costProvisionalFlag=false; // Nunca excluir por comparaciones ampliadas.
  }
}
function costRiskCondition(r){
  return state.costExclusionMode!=='verified' || !r._costFlag;
}
function ioarrCondition(r){
  return state.ioarrCondition!=='exclude' || !r._isReportedCanal;
}
function allConditions(r){return rowInScope(r)&&eligibleCondition(r)&&ioarrCondition(r)&&costRiskCondition(r)&&(!window.EscMulti||window.EscMulti.condition(r));}
function candidatesNow(){return state.eligible.filter(allConditions);}

function canonAmountForPliego(pliegoKey) {
  const rec = state.canonByPliego.get(pliegoKey);
  if (!rec || !rec.rawValues.length) return 0;
  if (rec.positiveValues.length) return Math.max(...rec.positiveValues);
  return Math.max(...rec.rawValues, 0);
}
function canonStatus(row) {
  const amount = canonAmountForPliego(row._pliego);
  if (amount == null) return 'SIN DATO';
  return amount > 0 ? 'CON CANON' : 'SIN CANON';
}
function deficitTotalPliego(pliegoKey) {
  return state.canonByPliego.get(pliegoKey)?.deficit || 0;
}
function canonCoverage(row) {
  const amount = canonAmountForPliego(row._pliego);
  const deficit = deficitTotalPliego(row._pliego);
  if (!deficit) return 0;
  if (amount == null) return 0;
  return amount / deficit * 100; // El valor bruto puede superar 100%; la cobertura efectiva se topa en 100%.
}
function matchCanonCoverage(row) {
  if (!state.coverageEnabled) return true;
  const coverage = canonCoverage(row);

  return Math.min(100, Math.max(0, coverage)) <= state.coverageMax + 1e-8;
}
function effectiveCanonBudget(pliegoKey) {
  const amount = canonAmountForPliego(pliegoKey);
  return state.canonAssist && amount != null ? Math.max(0, amount) * Math.max(0, Math.min(100,state.canonUsePercent)) / 100 : 0;
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
  const asc = state.rule !== 'pliego_max' && state.rule !== 'provincia_max' && state.rule !== 'distrito_max';
  return rows.slice().sort((a, b) => (asc ? a._deficit - b._deficit : b._deficit - a._deficit) || a._cui.localeCompare(b._cui));
}

function applyCanonAllocation(rows, rule = state.rule) {
  const clones = rows.map(r => ({ ...r, _canonApplied: 0, _deficitNet: r._deficit }));
  const groups = new Map();
  clones.forEach(r => {
    if (!groups.has(r._pliego)) groups.set(r._pliego, []);
    groups.get(r._pliego).push(r);
  });
  for (const [pliego, items] of groups) {
    let remainingCanon = effectiveCanonBudget(pliego);
    if (remainingCanon <= 0) continue;
    const ordered = items.slice().sort((a, b) => ((rule === 'pliego_max' || rule === 'provincia_max' || rule === 'distrito_max') ? b._deficit - a._deficit : a._deficit - b._deficit) || a._cui.localeCompare(b._cui));
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

/* CARTERA RECOMENDADA. Algoritmo de asignación incremental: el presupuesto
 * es GLOBAL y se consume con el déficit residual. El canon se asigna una sola vez
 * por pliego a medida que se seleccionan inversiones. La función objetivo es la
 * ganancia marginal de inversiones, pliegos, provincias, puentes o emergencia.
 * Es una HEURÍSTICA, no una prueba de optimalidad global.
 */
function recommendedCandidates(candidates, selectedRule = state.rule, scope = state.recommendScope) {
  if (scope === 'all') return candidates;
  const rule = selectedRule;
  if (rule === 'pliego_min' || rule === 'pliego_max') return chooseOne(candidates,r=>r._pliego,rule==='pliego_max');
  if (rule === 'provincia_min' || rule === 'provincia_max') return chooseOne(candidates,r=>r._provinceCode||`${r._region}|${upper(r._province)}`,rule==='provincia_max');
  if (rule === 'distrito_min' || rule === 'distrito_max') return chooseOne(candidates,r=>r._districtCode,rule==='distrito_max');
  return candidates;
}

/* Preselección por regla territorial (sin corte presupuestal).
 * La asignación del presupuesto se realiza EXCLUSIVAMENTE con MILP V16. */
function selectScenario(candidates, rule = state.rule) {
  let rows = candidates.slice();
  if(rule==='pliego_min'||rule==='pliego_max')rows=chooseOne(rows,r=>r._pliego,rule==='pliego_max');
  if(rule==='provincia_min'||rule==='provincia_max')rows=chooseOne(rows,r=>r._provinceCode,rule==='provincia_max');
  if(rule==='distrito_min'||rule==='distrito_max')rows=chooseOne(rows,r=>r._districtCode,rule==='distrito_max');
  return applyCanonAllocation(rows,rule).sort((a,b)=>b._deficitNet-a._deficitNet||a._cui.localeCompare(b._cui));
}

function eligibleCondition(row) {
  return (!state.fem || row._fem === 'SI') && matchCanonCoverage(row);
}
function rowInScope(row) {
  if (state.scopePliego && row._pliego!==state.scopePliego)return false;
  if (state.scopeDistrict) return row._districtCode === state.scopeDistrict;
  if (state.scopeProvince) return row._provinceCode === state.scopeProvince;
  if (state.scopeRegion) return row._regionCode === state.scopeRegion;
  return true;
}

function simulate() {
  const candidates = candidatesNow();
  state.scenario = state.activeView === 'recommended' && state.recommendation ? state.recommendation.rows : selectScenario(candidates, state.rule, 0); // En modo manual: preselección, no cartera financiada.
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
  setVal('metricPct', `${total ? Math.round(rows.length / total * 100) : 0}% de la cartera con déficit`);
  animateMetric('metricBridges', sum(rows, '_bridges'), fmtInt);
  animateMetric('metricPliegos', uniq(rows, '_pliego'), fmtInt);
  animateMetric('metricCost', sum(rows, '_cost'), fmtCompact);
  animateMetric('metricDeficitNet', sum(rows, '_deficitNet'), fmtCompact);
  setVal('metricGap', state.canonAssist ? `Canon considerado: ${fmtCompact(sum(rows, '_canonApplied'))} · Déficit original: ${fmtCompact(sum(rows, '_deficit'))}` : 'Déficit financiero original · Sin canon descontado');
  animateMetricCards();
}

function summaryName(mode, row) {
  if (mode === 'pliego') return row._pliegoDisplay;
  if (mode === 'district') return row._district || state.districtLabels.get(row._districtCode) || row._districtCode;
  if (mode === 'province') return row._province || state.provinceLabels.get(row._provinceCode) || row._provinceCode;
  return row._region || state.regionLabels.get(row._regionCode) || row._regionCode;
}
function summaryParent(mode, row) {
  if (mode === 'pliego') return `UE ${row._ubigeoUE} · ${row._region}`;
  if (mode === 'district') return `${row._province} · ${row._region}`;
  if (mode === 'province') return row._region;
  return `${uniq([row], '_provinceCode')} provincia(s)`;
}
function summaryKey(mode, row) {
  return mode === 'pliego' ? row._pliego : mode === 'district' ? row._districtCode : mode === 'province' ? row._provinceCode : row._regionCode;
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
        parent: mode === 'pliego' ? `UE ${row._ubigeoUE} · ${row._region}` : mode === 'district' ? `${row._province} · ${row._region}` : mode === 'province' ? row._region : `${row._region}`,
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
  const pliegoSummary=buildSummary('pliego',state.scenario);
  state.summaryCache = { district: districtSummary, province: provinceSummary, region: regionSummary,pliego:pliegoSummary };
  state.summaryMapCache = {
    district: new Map(districtSummary.map(x => [x.key, x])),
    province: new Map(provinceSummary.map(x => [x.key, x])),
    region: new Map(regionSummary.map(x => [x.key, x])),pliego:new Map(pliegoSummary.map(x=>[x.key,x]))
  };

  setVal('viewCountDistrict', fmtInt(districtSummary.length));
  setVal('viewCountProvince', fmtInt(provinceSummary.length));
  setVal('viewCountRegion', fmtInt(regionSummary.length));

  document.querySelectorAll('[data-map-view]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.mapView === state.mapView));

  const panelMode=state.territoryGrouping==='pliego'?'pliego':state.mapView;
  const summary = state.summaryCache[panelMode];
  const currentLabels = {
    district: ['DISTRITO', 'Distritos', 'Distribución distrital del escenario', 'Se listan los distritos que concentran inversiones seleccionadas.'],
    province: ['PROVINCIA', 'Provincias', 'Distribución provincial del escenario', 'Se listan las provincias que concentran inversiones seleccionadas.'],
    region: ['REGIÓN', 'Regiones', 'Distribución regional del escenario', 'Se listan las regiones que concentran inversiones seleccionadas.'],
    pliego:['PLIEGO / UE','Pliegos','Distribución por pliego ejecutor','El canon se atribuye al pliego, no al distrito donde está el puente.']
  }[panelMode];

  setVal('territoryPanelTitle', currentLabels[2]);
  setVal('territoryPanelHelper', currentLabels[3]);
  setVal('territoryCounter', `${fmtInt(summary.length)} ${currentLabels[1].toLowerCase()}`);
  $('territoryColumns').innerHTML = `<span>${currentLabels[0]}</span><span>IOARR</span><span>DÉFICIT</span><span>COSTO</span>`;

  const max = Math.max(1, ...summary.map(x => x.n));
  $('territoryList').innerHTML = summary.length ? summary.map(item => {
    const current = panelMode==='pliego'?state.scopePliego===item.key:panelMode === 'district' ? state.scopeDistrict === item.key : panelMode === 'province' ? state.scopeProvince === item.key : state.scopeRegion === item.key;
    return `<button type="button" class="esc-region-item ${current ? 'is-current' : ''}" data-scope-key="${esc(item.key)}" data-scope-mode="${panelMode}">
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
  if (state.scopePliego) return `${state.all.find(r=>r._pliego===state.scopePliego)?._pliegoDisplay||state.scopePliego} · Pliego`;
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
    <tr data-cui="${esc(r._cui)}" title="Abrir detalle del CUI" style="cursor:pointer">
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


const ESC_ALTERNATIVE_RULES = [
  ['priorizada', 'Cartera recomendada por objetivo'],
  ['todos', 'Todas las IOARR elegibles'],
  ['pliego_min', 'Una por pliego · menor déficit'],
  ['pliego_max', 'Una por pliego · mayor déficit'],
  ['provincia_min', 'Una por provincia · menor déficit'],
  ['provincia_max', 'Una por provincia · mayor déficit'],
  ['distrito_min','Una por distrito · menor déficit'],
  ['distrito_max','Una por distrito · mayor déficit']
];
function comparisonStats(rows, rule) {
  const spent=sum(rows,'_deficitNet');
  const territory=window.EscMulti?.statsByDistrict(rows);
  return {rule,rows,n:rows.length,pliegos:uniq(rows,'_pliego'),provincias:uniq(rows,'_provinceCode'),distritos:territory?.count||uniq(rows,'_districtCode'),vulnerables:territory?.vulnerable||0,riesgo:territory?.highEither||0,territorial:territory?new Set(territory.districts.filter(r=>(window.EscMulti?.matchesCondition(r,'poverty'))||(window.EscMulti?.matchesCondition(r,'risk'))).map(r=>r._districtCode)).size:0,priority:territory?.scoreSum||0,
    bridges:sum(rows,'_bridges'),cost:sum(rows,'_cost'),emergencies:rows.filter(r=>r._fem==='SI').length,spent,
    budgetRemaining:state.budget>0?Math.max(0,state.budget-spent):null};
}
function goalScore(stats,goal) {
  return ({ioarr:stats.n,pliegos:stats.pliegos,provincias:stats.provincias,puentes:stats.bridges,emergencia:stats.emergencies,vulnerables:stats.vulnerables,riesgo:stats.riesgo,territorial:stats.territorial,ahp:stats.priority})[goal]||0;
}
/* V16 instala al iniciar la interfaz el comparador y el optimizador MILP.
 * No se mantienen algoritmos heurísticos de asignación presupuestal. */
function renderComparison() {}
function generateRecommendation() { throw new Error('El módulo MILP V16 no está cargado.'); }

function invalidateRecommendation() {
  // Cualquier cambio de presupuesto/filtros/pesos invalida la solución anterior.
  state.recommendation=null;
  state.v16Last=null;
  state.activeView='manual';
  const result=document.getElementById('v16DecisionResult');
  if(result)result.innerHTML='<div class="v16-result-empty">Condiciones modificadas. Ejecuta «Optimizar cartera» para obtener una nueva solución.</div>';
  const status=document.getElementById('v16SolverStatus');
  if(status){status.textContent='Sin resultado MILP vigente. Las candidatas aún no constituyen una cartera financiada.';status.dataset.status='warning';}
}

function buildAuditRows() {
  const selected=new Set(state.scenario.map(r=>r._cui));
  const all=state.all;
  // Solo para identificar las candidatas descartadas por una regla de pliego/provincia.
  const filtered=candidatesNow();
  const rule=state.activeView==='recommended'?(state.recommendation?.scope==='current'?state.recommendation.baseRule:'todos'):state.rule;
  const allowed=rule==='pliego_min'||rule==='pliego_max'?chooseOne(filtered,r=>r._pliego,rule==='pliego_max'):
    rule==='provincia_min'||rule==='provincia_max'?chooseOne(filtered,r=>r._provinceCode,rule==='provincia_max'):
    rule==='distrito_min'||rule==='distrito_max'?chooseOne(filtered,r=>r._districtCode,rule==='distrito_max'):filtered;
  const allowedIds=new Set(allowed.map(r=>r._cui));
  state.auditRows=all.filter(r=>!selected.has(r._cui)).map(r=>{
    let reason='No seleccionada bajo la configuración vigente';
    if(!(r._deficit>0))reason='Fuera de la cartera con déficit: sin brecha financiera positiva';
    else if(!rowInScope(r))reason='Fuera del ámbito geográfico seleccionado';
    else if(state.fem&&r._fem!=='SI')reason=r._fem==='NO'?'Distrito no incluido en la declaratoria El Niño':'Distrito sin verificación en la declaratoria El Niño';
    else if(!ioarrCondition(r))reason='Registro identificado como canal, excluido del análisis de inversiones de puente';
    else if(window.EscMulti?.exclusionReason(r))reason=window.EscMulti.exclusionReason(r);
    else if(!costRiskCondition(r))reason=`Excluida por decisión explícita: costo por metro ≥ ${state.costAlertFactor.toFixed(2)} veces la referencia de pares similares en ${r._regionNatural.toLowerCase()}`;
    else if(state.activeView==='recommended'&&state.recommendation?.goal==='ahp'&&r._ahpScore==null)reason='No evaluable por información incompleta en un criterio AHP activo';
    else if(state.coverageEnabled&&!matchCanonCoverage(r))reason=`Canon del pliego cubre más de ${state.coverageMax} % del déficit`;
    else if(!allowedIds.has(r._cui)){
      const insufficient=rule.includes('pliego')?!r._pliego:rule.includes('distrito')?!r._districtCode:(!r._provinceCode&&!r._province);
      reason=insufficient?'Sin datos territoriales o de pliego suficientes para aplicar la regla':rule.includes('pliego')?'Otra IOARR del mismo pliego cumple mejor la regla':rule.includes('distrito')?'Otra IOARR del distrito cumple mejor la regla':'Otra IOARR de la provincia cumple mejor la regla';
    }
    else if(state.budget>0){
      const pool=state.canonAssist?effectiveCanonBudget(r._pliego):0;
      const minNeed=Math.max(0,r._deficit-pool);
      if(minNeed>state.budget)reason='Su brecha excede por sí sola el presupuesto global';
      else if(state.activeView==='recommended')reason='Elegible no seleccionada por la optimización bajo el presupuesto y objetivo activos';
      else reason='Candidata no evaluada aún por el optimizador (sin selección financiera acreditada)';
    } else if(rule!=='todos')reason='No seleccionada por regla de distribución';
    const notEligible=!(r._deficit>0)||!rowInScope(r)||(state.fem&&r._fem!=='SI')||!ioarrCondition(r)||!costRiskCondition(r)||(state.coverageEnabled&&!matchCanonCoverage(r))||!!window.EscMulti?.exclusionReason(r);
    return {...r,_auditReason:reason,_auditStatus:notEligible?'No elegible bajo condiciones':'Elegible no seleccionada'};
  });
  return state.auditRows;
}
function renderAudit() {
  const rows=buildAuditRows();
  setVal('auditCounter',`${fmtInt(rows.length)} no seleccionadas`);
  $('auditBody').innerHTML=rows.slice(0,180).map(r=>`<tr><td>${esc(r._cui)}</td><td><b>${esc(r._pliegoDisplay)}</b><small>${esc(r._province)} · ${esc(r._region)}</small></td><td>${fmtCompact(r._deficit)}</td><td>${esc(r._auditStatus)}</td><td>${esc(r._auditReason)}</td></tr>`).join('')||'<tr><td colspan="5">Todas las IOARR de la cartera con déficit están seleccionadas.</td></tr>';
}

function renderCostZoneAverages(rows){
  const zones=['COSTA','SIERRA','SELVA'];
  const cells=zones.map(zone=>{
    const list=rows.filter(r=>r._regionNatural===zone && r._cost>0 && r._lengthTotal>0 && r._bridges>0 && !r._isReportedCanal);
    const totalCost=sum(list,'_cost');
    const totalLength=sum(list,'_lengthTotal');
    const costPerMeter=totalLength?totalCost/totalLength:0;
    const averageCost=list.length?totalCost/list.length:0;
    const caveat=list.length<5?'Pocos registros; cifra descriptiva.':'Promedio de la cartera con déficit; no es precio normativo.';
    return `<div class="esc-zone-card"><span>${zone}</span><strong>${list.length?fmtCompact(costPerMeter)+'/m':'Sin datos'}</strong><small>${fmtInt(list.length)} IOARR · Costo promedio/inversión: ${list.length?fmtCompact(averageCost):'—'}</small><em>${caveat}</em></div>`;
  });
  $('costZoneAverages').innerHTML=cells.join('');
}

function renderCostAlerts(){
  // Las referencias de costos se calculan en la cartera con déficit.
  // Mostrar observaciones no excluye. Sólo el selector de exclusión modifica
  // las candidatas ANTES de aplicar la regla y el presupuesto.
  const rows=state.eligible.filter(r=>rowInScope(r)&&eligibleCondition(r)&&ioarrCondition(r));
  const valid=rows.filter(r=>r._costPerMeter!=null && !r._isReportedCanal);
  const flagged=valid.filter(r=>r._costFlag);
  const excludedByCost=rows.filter(r=>!costRiskCondition(r));
  const listed=(state.costOnlyAlerts?flagged:valid).slice().sort((a,b)=>(b._costRatio||0)-(a._costRatio||0)||a._cui.localeCompare(b._cui));
  renderCostZoneAverages(state.eligible);
  setVal('costRiskCounter',`${fmtInt(flagged.length)} alertas`);
  setVal('costReviewCount',fmtInt(valid.length));
  setVal('costAlertCount',fmtInt(flagged.length));
  setVal('costMissingCount',fmtInt(excludedByCost.length));
  setVal('costZoneCount',`${fmtInt(valid.filter(r=>r._costReference!=null).length)} inversiones con referencia por zona natural`);
  const impact=state.costImpact;
  const modeLabel=state.costExclusionMode==='none'?'Solo revisión: el costo no altera la cartera.':
    `${fmtInt(excludedByCost.length)} candidatas apartadas por alerta, antes de aplicar la regla financiera.`;
  const delta=impact ? ` Respecto de la selección previa: ${fmtInt(impact.removed)} salieron y ${fmtInt(impact.added)} ingresaron como sustitutas.` : '';
  setVal('costExclusionNote',modeLabel+delta+(state.costExclusionMode==='verified'&&impact&&impact.removed===0&&impact.added===0?' Los indicadores no cambian porque las alertas no formaban parte de la cartera previamente seleccionada.':''));
  $('costAlertBody').innerHTML=listed.length?listed.slice(0,200).map(r=>{
    const difference=r._costReference!=null?`${r._costDifference>=0?'+':''}${fmtCompact(r._costDifference)}/m (${r._costDifferencePercent>=0?'+':''}${r._costDifferencePercent.toFixed(0)} %)`:'Sin referencia';
    const status=r._costFlag?'REVISAR COSTO':r._costStrictComparable?'SIN ALERTA':'REFERENCIA AMPLIADA';
    return `<tr class="${r._costFlag?'esc-cost-row-alert':''}"><td><b>${esc(r._cui)}</b></td><td>${esc(r._regionNatural)}<small>${esc(r._region)}</small></td><td>${fmtInt(r._bridges)}<small>${Number(r._avgBridgeLength||0).toLocaleString('es-PE',{maximumFractionDigits:1})} m/puente</small></td><td>${fmtInt(r._lengthTotal)} m</td><td>${fmtCompact(r._cost)}</td><td><b>${fmtCompact(r._costPerMeter)}/m</b></td><td>${difference}<small>${esc(r._costReferenceType)} · ${fmtInt(r._costPeers)} pares</small></td><td><span class="${r._costFlag?'esc-cost-status-alert':'esc-cost-status-neutral'}">${status}</span></td></tr>`;
  }).join(''):'<tr><td colspan="8">No hay inversiones con alerta para esta selección.</td></tr>';
  setVal('costAuditNote',`Costo/m = costo actualizado ÷ longitud total; luz media = longitud total ÷ número de puentes. Alerta: ≥ ${state.costAlertFactor.toFixed(2)} veces el valor central de cinco o más pares comparables. No se dispone de altura de estribos, cimentación ni accesos: ningún resultado prueba sobrecosto.`);
}
function renderAll() {
  if(window.EscMulti) window.EscMulti.renderDiagnostics();
  renderMetrics();
  renderTerritoryPanel();
  renderDetail();
  renderComparison();
  renderAudit();
  renderCostAlerts();
  updateMap();
}

function applyScope(mode, key, rerun = true) {
  const prevRegion = state.scopeRegion;
  const prevProvince = state.scopeProvince;
  const prevDistrict = state.scopeDistrict;
  const prevPliego=state.scopePliego;
  state.scopeRegion = '';
  state.scopeProvince = '';
  state.scopeDistrict = '';
  state.scopePliego='';
  if(mode==='pliego')state.scopePliego=prevPliego===key?'':key;
  if (mode === 'region') state.scopeRegion = prevRegion === key ? '' : key;
  if (mode === 'province') state.scopeProvince = prevProvince === key ? '' : key;
  if (mode === 'district') state.scopeDistrict = prevDistrict === key ? '' : key;
  if (rerun) { invalidateRecommendation();simulate(); focusMapToScope(); }
  updateMapBreadcrumb();
}

// Drill-down por límites administrativos: departamento → provincias → distritos.
function drillMapTerritory(mode,key){
  if(!key)return;
  applyScope(mode,key,true);
  const next=mode==='region'?'province':mode==='province'?'district':null;
  if(next){state.mapView=next;activateMapView(next);}else{focusMapToScope();}
  updateMapBreadcrumb();
}
function updateMapBreadcrumb(){
  const box=document.getElementById('v20MapBreadcrumb');if(!box)return;
  const label=(mode,code)=>escLayerCache.get(mode)?.names?.get(code)||code;
  const parts=[`<button type="button" data-v20-back="region">Perú</button>`];
  if(state.scopeRegion||state.scopeProvince||state.scopeDistrict){const code=state.scopeRegion||state.scopeProvince?.slice(0,2)||state.scopeDistrict?.slice(0,2);parts.push(`<span>›</span><button type="button" data-v20-back="province" data-v20-code="${code}">${label('region',code)}</button>`);}
  if(state.scopeProvince||state.scopeDistrict){const code=state.scopeProvince||state.scopeDistrict.slice(0,4);parts.push(`<span>›</span><button type="button" data-v20-back="district" data-v20-code="${code}">${label('province',code)}</button>`);}
  if(state.scopeDistrict)parts.push(`<span>›</span><strong>${label('district',state.scopeDistrict)}</strong>`);
  else parts.push(`<span class="v20-breadcrumb-hint">${state.mapView==='region'?'Elige un departamento':state.mapView==='province'?'Elige una provincia':'Elige un distrito'}</span>`);
  box.innerHTML=parts.join('');
}
function clearScopes() {
  state.scopeRegion = ''; state.scopeProvince = ''; state.scopeDistrict = ''; state.scopePliego='';
  updateMapBreadcrumb();
}

// Importes en soles: agrupación de miles visible sin alterar los importes numéricos.
function parseMoneyInput(value) {
  const clean=text(value).replace(/[^0-9]/g,'');
  return clean?Number(clean):0;
}
function formatMoneyInput(input) {
  const n=parseMoneyInput(input.value);
  input.value=n?n.toLocaleString('en-US',{maximumFractionDigits:0}):'';
}
function formatMoneyLive(input){
  const caret=input.selectionStart||0;
  const digitsBefore=(input.value.slice(0,caret).match(/[0-9]/g)||[]).length;
  const value=parseMoneyInput(input.value);
  const formatted=value?value.toLocaleString('en-US',{maximumFractionDigits:0}):'';
  input.value=formatted;
  let pos=0, count=0;
  while(pos<formatted.length&&count<digitsBefore){if(/[0-9]/.test(formatted[pos]))count++;pos++;}
  input.setSelectionRange(pos,pos);
  setVal('budgetLiveReadout',value?`Monto ingresado: ${fmtFull(value)}`:'Ingresa un monto global en soles.');
}
function refreshBudgetUi() {
  const btn = $('clearBudget');
  btn.classList.toggle('is-free', !state.budget);
  btn.innerHTML = '<i class="bi bi-x-circle"></i> Quitar presupuesto';
}


function renderRecommendationScope(){
  const el=$('recommendScopeExplain');if(!el)return;
  if(state.rule==='todos'){
    el.textContent='Con «Todas las IOARR», ambas opciones generan la misma base de candidatas.';
  } else if(state.recommendScope==='current'){
    el.textContent='La propuesta conservará la inversión por pliego o provincia que ya elegiste. El Niño, canon, canales, costo y territorio siempre se mantienen.';
  } else {
    el.textContent='La propuesta podrá cambiar cuál IOARR se elige por pliego/provincia. El Niño, canon, canales, costo y territorio siempre se mantienen.';
  }
}
function setupControls() {
  const change=()=>{invalidateRecommendation();state.costImpact=null;simulate();renderRecommendationScope();};
  document.querySelectorAll('input[name="selRule"]').forEach(input=>input.addEventListener('change',()=>{state.rule=input.value;state.lastManualRule=state.rule;state.activeView='manual';change();}));
  $('mcTerritoryGrouping').addEventListener('change',e=>{state.territoryGrouping=e.target.value;renderTerritoryPanel();});
  $('filterFem').addEventListener('change',e=>{state.fem=e.target.checked;change();});
  $('coverageEnabled').addEventListener('change',e=>{state.coverageEnabled=e.target.checked;$('coverageControls').hidden=!state.coverageEnabled;change();});
  $('coverageMax').addEventListener('input',e=>{state.coverageMax=Number(e.target.value);setVal('coverageMaxValue',`${state.coverageMax} %`);change();});
  $('assistCanon').addEventListener('change',e=>{state.canonAssist=e.target.checked;$('canonPoolControls').hidden=!state.canonAssist;$('canonAssistBox').hidden=!state.canonAssist;change();});
  $('canonUsePercent').addEventListener('input',e=>{state.canonUsePercent=Number(e.target.value);setVal('canonUsePercentValue',`${state.canonUsePercent} %`);change();});
  $('comparisonGoal').addEventListener('change',e=>{state.comparisonGoal=e.target.value;change();});
  $('recommendScope').addEventListener('change',e=>{state.recommendScope=e.target.value;invalidateRecommendation();renderRecommendationScope();renderAll();});
  $('runRecommendation').addEventListener('click',generateRecommendation);
  $('costOnlyAlerts').addEventListener('change',e=>{state.costOnlyAlerts=e.target.checked;renderCostAlerts();});
  $('excludeCanals').addEventListener('change',e=>{state.ioarrCondition=e.target.checked?'exclude':'all';state.costImpact=null;change();});
  $('costExclusionMode').addEventListener('change',e=>{
    const before=new Set(state.scenario.map(r=>r._cui));
    state.costExclusionMode=e.target.value;
    change();
    const after=new Set(state.scenario.map(r=>r._cui));
    state.costImpact={removed:[...before].filter(id=>!after.has(id)).length,added:[...after].filter(id=>!before.has(id)).length};
    renderCostAlerts();
  });
  $('costAlertFactor').addEventListener('input',e=>{setVal('costAlertFactorLabel',`${Number(Number(e.target.value).toFixed(2)).toLocaleString('es-PE')} veces (+${Math.round((Number(e.target.value)-1)*100)} %)`);});
  $('costAlertFactor').addEventListener('change',e=>{
    const before=new Set(state.scenario.map(r=>r._cui));
    state.costAlertFactor=Number(e.target.value);
    setVal('costAlertFactorLabel',`${Number(state.costAlertFactor.toFixed(2)).toLocaleString('es-PE')} veces (+${Math.round((state.costAlertFactor-1)*100)} %)`);
    refreshCostRiskFlags();
    change();
    const after=new Set(state.scenario.map(r=>r._cui));
    state.costImpact={removed:[...before].filter(id=>!after.has(id)).length,added:[...after].filter(id=>!before.has(id)).length};
    renderCostAlerts();
  });
  $('budgetOrder').addEventListener('change',e=>{state.budgetOrder=e.target.value;change();});
  $('comparisonBody').addEventListener('click',e=>{
    const button=e.target.closest('button[data-rule]');if(!button)return;
    if(button.dataset.rule==='priorizada'){if(state.recommendation){state.activeView='recommended';simulate();}return;}
    state.activeView='manual';state.rule=button.dataset.rule;state.lastManualRule=state.rule;
    const radio=document.querySelector(`input[name="selRule"][value="${state.rule}"]`);if(radio)radio.checked=true;
    // La recomendación comparada continúa visible hasta editar una condición.
    simulate();
  });
  let budgetDebounce;
  $('budgetInput').addEventListener('input',e=>{
    if(/[a-zA-Z]/.test(e.target.value)){
      clearTimeout(budgetDebounce);
      setVal('budgetLiveReadout','Indica el monto completo en soles; no escribas «M» ni «millones».');
      return;
    }
    formatMoneyLive(e.target);
    clearTimeout(budgetDebounce);
    budgetDebounce=setTimeout(()=>{state.budget=parseMoneyInput(e.target.value);refreshBudgetUi();change();},220);
  });
  $('budgetInput').addEventListener('change',e=>{
    if(/[a-zA-Z]/.test(e.target.value)){
      clearTimeout(budgetDebounce);
      setVal('budgetLiveReadout','Monto inválido: expresa el presupuesto en soles, por ejemplo 10000000.');
      return;
    }
    clearTimeout(budgetDebounce);formatMoneyInput(e.target);state.budget=parseMoneyInput(e.target.value);setVal('budgetLiveReadout',state.budget?`Monto ingresado: ${fmtFull(state.budget)}`:'Ingresa un monto global en soles.');refreshBudgetUi();change();});
  $('clearBudget').addEventListener('click',()=>{$('budgetInput').value='';state.budget=0;setVal('budgetLiveReadout','Sin presupuesto: no se puede optimizar.');refreshBudgetUi();change();});
  document.querySelectorAll('[data-budget-fraction]').forEach(btn=>btn.addEventListener('click',()=>{
    state.budget=Math.round(sum(state.eligible,'_deficit')*Number(btn.dataset.budgetFraction));
    $('budgetInput').value=state.budget.toLocaleString('en-US',{maximumFractionDigits:0});
    setVal('budgetLiveReadout',`Monto ingresado: ${fmtFull(state.budget)}`);refreshBudgetUi();change();
  }));
  $('resetEsc').addEventListener('click',()=>{
    state.rule='todos';state.lastManualRule='todos';state.activeView='manual';state.recommendation=null;state.recommendScope='current';state.costOnlyAlerts=false;state.ioarrCondition='all';state.costExclusionMode='none';state.canonUsePercent=100;state.fem=false;state.coverageEnabled=false;state.coverageMax=50;state.comparisonGoal='ioarr';state.budget=0;state.budgetOrder='asc';state.search='';state.mapView='region';state.canonAssist=false;clearScopes();
    document.querySelector('input[name="selRule"][value="todos"]').checked=true;
    $('filterFem').checked=false;$('coverageEnabled').checked=false;$('coverageControls').hidden=true;$('coverageMax').value='50';setVal('coverageMaxValue','50 %');
    $('comparisonGoal').value='ioarr';$('budgetInput').value='';setVal('budgetLiveReadout','Ingresa un monto global en soles.');$('budgetOrder').value='asc';$('recommendScope').value='current';
    $('detailSearch').value='';$('assistCanon').checked=false;$('canonPoolControls').hidden=true;$('canonAssistBox').hidden=true;$('canonUsePercent').value='100';setVal('canonUsePercentValue','100 %');$('costOnlyAlerts').checked=false;$('excludeCanals').checked=false;$('costExclusionMode').value='none';$('costAlertFactor').value='2.5';setVal('costAlertFactorLabel','2.5 veces (+150 %)');state.costAlertFactor=2.5;state.costImpact=null;refreshCostRiskFlags();
    refreshBudgetUi();simulate();activateMapView('region');
  });
  $('detailSearch').addEventListener('input',e=>{state.search=e.target.value;renderDetail();});
  $('exportExcel').addEventListener('click',()=>exportExcel());
  $('clearScope').addEventListener('click',()=>{clearScopes();change();state.mapView='region';activateMapView('region');});
  $('v20MapBreadcrumb')?.addEventListener('click',e=>{const btn=e.target.closest('[data-v20-back]');if(!btn)return;const mode=btn.dataset.v20Back,code=btn.dataset.v20Code;if(mode==='region'){clearScopes();state.mapView='region';simulate();activateMapView('region');}else if(mode==='province'){applyScope('region',code,true);state.mapView='province';activateMapView('province');}else if(mode==='district'){applyScope('province',code,true);state.mapView='district';activateMapView('district');}});
  document.querySelectorAll('[data-map-view]').forEach(btn=>btn.addEventListener('click',()=>{state.mapView=btn.dataset.mapView;renderTerritoryPanel();activateMapView(state.mapView);}));
  $('mapZoomIn').addEventListener('click',()=>zoomMap(.77));
  $('mapZoomOut').addEventListener('click',()=>zoomMap(1.3));
  $('mapZoomReset').addEventListener('click',toggleMapFullscreen);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('priorityMap').closest('.esc-map-card').classList.contains('is-map-expanded'))toggleMapFullscreen();});
  refreshBudgetUi();
}
function toggleMapFullscreen(){
  const card=$('priorityMap').closest('.esc-map-card');const expanded=card.classList.toggle('is-map-expanded');
  $('mapZoomReset').innerHTML=expanded?'<i class="bi bi-fullscreen-exit"></i>':'<i class="bi bi-arrows-fullscreen"></i>';
  $('mapZoomReset').setAttribute('aria-label',expanded?'Cerrar mapa ampliado':'Ampliar mapa a pantalla completa');
  $('mapZoomReset').title=expanded?'Cerrar mapa ampliado':'Ampliar mapa';
}

function scenarioCriteria() {
  const names = {
    priorizada: 'Cartera recomendada según objetivo y presupuesto',
    distrito_min: 'Una inversión por distrito: menor déficit',
    distrito_max: 'Una inversión por distrito: mayor déficit',
    todos: 'Todas las IOARR elegibles',
    pliego_min: 'Una inversión por pliego: menor déficit',
    pliego_max: 'Una inversión por pliego: mayor déficit',
    provincia_min: 'Una inversión por provincia: menor déficit',
    provincia_max: 'Una inversión por provincia: mayor déficit'
  };
  return [
    ['Fórmula de déficit aplicada','Costo actualizado − PIM 2026 − Devengado acumulado al 2025 − PIA 2027'],
    ['Fuente de datos','Base_Maestra_Ley_32416_para_JSON(6).xlsx · hoja BASE TOTAL · 827 CUI'],
    ['Diferencia entre déficit matemático y brecha financiable','Déficit calculado puede ser negativo; solo el saldo positivo constituye requerimiento adicional de recursos'],
    ['Cartera analizada',state.activeView==='recommended'?'Recomendación generada':names[state.rule] || state.rule],
    ['Modalidades territoriales', ['Pobreza','Riesgo','Agricultura'].map((x,i)=>`${x}: ${[document.getElementById('mcPovertyMode')?.value,document.getElementById('mcRiskMode')?.value,document.getElementById('mcAgriMode')?.value][i]||'Informar'}`).join(' · ')],
    ['Modelo AHP', window.EscMulti?.activeProfile()?.name || 'No aplicado'],
    ['Razón de consistencia AHP',window.EscMulti?.activeProfile()?`${(window.EscMulti.activeProfile().cr*100).toFixed(2)} %`:'No aplica'],
    ['Distrito vulnerables atendidos',String(window.EscMulti?.statsByDistrict(state.scenario).vulnerable??'No determinado')],
    ['Orden por presupuesto',state.budgetOrder==='asc'?'Menor brecha primero':'Mayor brecha primero'],
    ['Objetivo de asignación', $('comparisonGoal').selectedOptions[0].text],
    ['Base de recomendación',state.recommendation?.scopeLabel||'No generada'],
    ['Registros de canal identificados',state.ioarrCondition==='exclude'?'Excluir CUI 2677338, 2675020 y 2658249':'Incluir todos'],
    ['Canon aplicable estimado',`${state.canonUsePercent} % del canon registrado (si se activa)`],
    ['Control de costos',state.costExclusionMode==='none'?'Solo revisión, sin exclusión':`Excluir alertas ≥ ${state.costAlertFactor} veces el costo/m de pares similares`],
    ['Emergencia PCM (campo actualizado)', state.fem ? 'Solo distritos con indicador SI' : 'Sin restricción'],
    ['Cobertura del déficit con canon', state.coverageEnabled ? `Hasta ${state.coverageMax} % · canon no informado se considera 0 %` : 'Sin restricción'],
    ['Canon considerado para cubrir brecha', state.canonAssist ? 'Sí, monto del pliego aplicado una sola vez (referencial)' : 'No; déficit sin canon adicional'],
    ['Techo financiero total', state.budget > 0 ? fmtFull(state.budget) : 'Sin límite financiero'],
    ['Ámbito geográfico', currentScopeLabel()],
    ['Cartera total con déficit', `${fmtInt(state.eligible.length)} IOARR con déficit positivo`],
    ['Inversiones seleccionadas', `${fmtInt(state.scenario.length)} IOARR`],
    ['Pliegos seleccionados', `${fmtInt(uniq(state.scenario, '_pliego'))}`],
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
  const columns = ['CUI', 'Región', 'Provincia', 'Distrito', 'Pliego', 'Puentes', 'Déficit (S/)', 'Canon considerado (S/)', 'Brecha pendiente (S/)', 'Costo actualizado (S/)', 'Cobertura canon (%)', 'El Niño', 'Nombre de inversión', 'Canon del pliego (S/)', 'UBIGEO', 'Ítem anexo PCM', 'UBIGEO UE', 'Ranking pobreza distrital', 'Quintil', 'Área agrícola (ha)', 'Riesgo inundación', 'Riesgo movimientos en masa', 'Puntaje AHP', 'Posición AHP', 'PIM 2026 (S/)', 'Devengado acumulado 2025 (S/)', 'PIA 2027 (S/)', 'Déficit calculado (S/)'];
  const query = upper(state.search);
  const visibleRows = state.scenario.filter(r => !query || r._cui.includes(query) || r._pliego.includes(query) || upper(r._district).includes(query) || upper(r._province).includes(query) || upper(r._region).includes(query));
  const records = visibleRows.map(r => [r._cui, r._region, r._province, r._district, r._pliegoDisplay, r._bridges, r._deficit, r._canonApplied, r._deficitNet, r._cost, canonCoverage(r), r._fem, r.denominacion_inversion || '', canonAmountForPliego(r._pliego),r._districtCode,r._femNum,r._ubigeoUE,r['RANKING POBREZA'],r['QUINTIL POBREZA'],r['AREA AGRICOLA'],r['NIVEL DE RIESGO POR INUNDACIONES'],r['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA'],r._ahpScore,r._ahpRank,r.pim,r.devengado_acumulado,r['PIA 2027'],r.deficit]);
  const auditRows=buildAuditRows();
  const auditColumns=['CUI','Pliego','Región','Provincia','Distrito','Déficit original (S/)','Estado del CUI','Motivo de no selección'];
  const auditRecords=auditRows.map(r=>[r._cui,r._pliegoDisplay,r._region,r._province,r._district,r._deficit,r._auditStatus,r._auditReason]);
  const file = `alternativas_atencion_ley32416_${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    window.ESCExcel.download({ filename: file, title: 'Ley N.° 32416 - Evaluación de alternativas de atención', criteria: scenarioCriteria(), columns, records, comparisons: state.comparisonResults, moneyColumns: [6,7,8,9,13,24,25,26,27], integerColumns: [5,17,23],auditColumns,auditRecords });
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
      drillMapTerritory(mode,key);
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
    const thematic=window.EscMulti?.mapStyle(mode,code);
    shape.classList.toggle('is-thematic',!!thematic);
    if(thematic)shape.style.setProperty('--mc-map-fill',thematic.fill);else shape.style.removeProperty('--mc-map-fill');
  }
  const thematicLayer=$('mcMapLayer')?.value!=='selected';
  if(thematicLayer){$('badgeLayer')?.replaceChildren();}else renderRegionalMarkers();
  $('regionalCounter').hidden = mode !== 'region';
  setVal('viewCountRegion', fmtInt((state.summaryCache[mode]||[]).length));
  const counter=document.getElementById('regionalCounter');
  if(counter){counter.hidden=false;const text=counter.querySelector('small');if(text)text.textContent={region:'REGIONES',province:'PROVINCIAS',district:'DISTRITOS'}[mode]+' CON IOARR';}

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
  const thematic=window.EscMulti?.tooltip(mode,code)||'';
  const summary=`<div class="v20-map-tooltip-metrics"><span><b>${fmtInt(item?.n||0)}</b> IOARR</span><span><b>${esc(fmtCompact(item?.deficitNet||0))}</b> brecha</span></div>`;
  t.innerHTML=`<strong>${esc(item?.name||label)}</strong>${thematic}${summary}<small class="v20-tooltip-next">${mode==='region'?'Clic para ver provincias':mode==='province'?'Clic para ver distritos':'Clic para seleccionar distrito'}</small>`;
  t.hidden = false;
  positionGeoTooltip(event);
}
function positionGeoTooltip(event) {
  const wrap = $('priorityMap').parentElement, bounds = wrap.getBoundingClientRect(), tip = $('mapTooltip');
  const w = 280, h = Math.min(240,tip.offsetHeight||160);
  tip.style.left = `${Math.max(8, Math.min(event.clientX - bounds.left + 14, bounds.width - w - 10))}px`;
  tip.style.top = `${Math.max(8, Math.min(event.clientY - bounds.top + 16, bounds.height - h - 10))}px`;
}
function renderRegionalMarkers() {
  const badges = $('badgeLayer');
  badges.replaceChildren();
  if (state.mapView !== 'region') return;
  const layer = escLayerCache.get('region');
  if (!layer) return;
  const frag = document.createDocumentFragment(), occupied = [];
  const items = (state.summaryCache.region || []).slice().sort((a,b)=>b.n-a.n);
  const offsets = [[0,0],[18,0],[-18,0],[0,-20],[0,20],[20,-18],[-20,18],[30,10],[-30,-10],[0,36],[0,-36],[37,-12],[-37,12],[48,0],[-48,0]];
  for (const item of items) {
    const path = layer.paths.get(item.key); if (!path) continue;
    const box = path.getBBox(), cx = box.x + box.width/2, cy = box.y + box.height/2;
    let x=cx,y=cy;
    for (const [dx,dy] of offsets) {
      const tx=cx+dx, ty=cy+dy;
      if (tx < 14 || tx > 586 || ty < 20 || ty > 625) continue;
      if (occupied.every(v=>Math.hypot(v.x-tx,v.y-ty)>=27)) {x=tx;y=ty;break;}
    }
    occupied.push({x,y});
    const g=document.createElementNS(ESC_NS,'g');
    g.setAttribute('class','esc-region-marker esc-marker-improved');
    g.setAttribute('transform',`translate(${x},${y})`);
    const title=document.createElementNS(ESC_NS,'title'); title.textContent=`${item.name}: ${item.n} IOARR`;
    if (Math.hypot(cx-x,cy-y)>5) {
      const line=document.createElementNS(ESC_NS,'line');
      line.setAttribute('x1',String(cx-x));line.setAttribute('y1',String(cy-y));
      line.setAttribute('x2','0');line.setAttribute('y2','0');line.setAttribute('class','esc-marker-line');g.appendChild(line);
    }
    const circle=document.createElementNS(ESC_NS,'circle');circle.setAttribute('r','15');
    const number=document.createElementNS(ESC_NS,'text');number.textContent=String(item.n);
    g.append(circle,number,title);g.addEventListener('click',ev=>{ev.stopPropagation();drillMapTerritory('region',item.key);});frag.appendChild(g);
  }
  badges.appendChild(frag);
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
    setVal('mapSubtitle', `${mode==='region'?'Departamentos':mode==='province'?'Provincias':'Distritos'} · ${mode==='region'?'Selecciona un departamento para ver sus provincias':mode==='province'?'Selecciona una provincia para ver sus distritos':'Selecciona un distrito para explorar la cartera'}`);
    document.querySelectorAll('[data-map-view]').forEach(btn => {
      const selected = btn.dataset.mapView === mode;
      btn.classList.toggle('is-active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    updateMap(); focusMapToScope();updateMapBreadcrumb();
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
  renderRecommendationScope();
  try {
    const [dataResponse, femResponse, regionResponse] = await Promise.all([
      fetch(ESC_DATA_URL, {cache:'no-store'}),fetch(ESC_FEM_URL,{cache:'no-store'}),
      fetch(ESC_NATURAL_REGION_URL,{cache:'no-store'}).catch(()=>null)
    ]);
    if (!dataResponse.ok || !femResponse.ok) throw new Error('No se pudo leer la cartera o la declaratoria');
    const [records, fem, naturalRegions] = await Promise.all([
      dataResponse.json(),femResponse.json(),
      regionResponse && regionResponse.ok ? regionResponse.json() : Promise.resolve([])
    ]);
    if (!Array.isArray(records) || !Array.isArray(fem)) throw new Error('Fuentes JSON inválidas');
    prepareData(records, fem, Array.isArray(naturalRegions)?naturalRegions:[]);
    if(window.EscMulti)window.EscMulti.init(state,(recalculate=true)=>{if(recalculate){invalidateRecommendation();simulate();}else updateMap();});

    simulate();
    await activateMapView('region');
  } catch (err) {
    console.error('Escenarios:', err);
    setVal('mapSubtitle', 'Error de carga');
    $('mapLoading').textContent = `No se pudieron leer los datos: ${err.message}. Revisa data/puentes.json y el servidor local.`;
  }
}
window.addEventListener('DOMContentLoaded', load);



/* ===== Componente integrado: interfaz v16 ===== */
/* Orquestación V16: interfaz de tres pasos + motor MILP real.
 * No invoca la asignación heurística anterior.
 */
'use strict';
(function () {
  const L = window.ESC_MILP_CORE;
  const GLPK_CDN = 'https://cdn.jsdelivr.net/npm/glpk.js@4.0.2/dist/index.js';
  let glpkInstance = null;
  let inProgress = false;
  state.riskFilter = 'all';
  state.v16Status = 'Define un presupuesto y pulsa «Optimizar cartera».';

  const $v = id => document.getElementById(id);
  const localEsc = x => String(x ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const money = n => `S/ ${Number(n||0).toLocaleString('es-PE',{maximumFractionDigits:2})}`;
  function setStatus(message, type = 'neutral') {
    state.v16Status = message;
    const elem=$v('v16SolverStatus');
    if(elem){elem.textContent=message;elem.dataset.status=type;}
  }

  function clearStale() {
    state.recommendation = null;
    state.activeView = 'manual';
    state.v16Last = null;
    setStatus('Se cambiaron condiciones. Ejecuta nuevamente la optimización.');
  }

  function currentSnapshot() {
    return JSON.stringify({
      budget:state.budget,rule:state.rule,pcm:state.fem,risk:state.riskFilter,
      canon:state.canonAssist,percentage:state.canonUsePercent,coverage:state.coverageEnabled,
      max:state.coverageMax,ioarr:state.ioarrCondition,cost:state.costExclusionMode,
      factor:state.costAlertFactor,goal:state.comparisonGoal,
      region:state.scopeRegion,province:state.scopeProvince,district:state.scopeDistrict,
      pliego:state.scopePliego,departamentosMultiples:window.ESC_V17_DEPT_CODES||[],ahp:window.EscMulti?.activeProfile()?JSON.stringify({name:window.EscMulti.activeProfile().name,keys:window.EscMulti.activeProfile().keys,weights:window.EscMulti.activeProfile().weights}):null,
      poverty:$v('mcPovertyMode')?.value,povertyQ:$v('mcPovertyQuintile')?.value,
      riskMode:$v('mcRiskMode')?.value,riskHazard:$v('mcRiskHazard')?.value,
      agriMode:$v('mcAgriMode')?.value,agriMin:$v('mcAgriMin')?.value
    });
  }

  function normalizedCandidates() {
    // candidatesNow ya incorpora la misma pila de reglas del tablero, incluida
    // la capa PCM y la restricción distrital CENEPRED de V16.
    return candidatesNow().map(r=>({
      cui:r._cui,pliego:r._pliego,province:r._provinceCode,district:r._districtCode,
      deficit:r._deficit,bridges:r._bridges,canonMax:canonAmountForPliego(r._pliego),
      canonCoverage:canonCoverage(r),pcm:r._fem==='SI',
      flood:r['NIVEL DE RIESGO POR INUNDACIONES'],
      mass:r['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA'],
      poor:!!window.EscMulti?.matchesCondition(r,'poverty'),
      ahpScore:r._ahpScore, canal:r._isReportedCanal,costFlag:r._costFlag,
      ref:r
    }));
  }
  function buildParams() {
    return {
      budget:state.budget,rule:state.rule,goal:state.comparisonGoal,
      pcm:'all',risk:'all',coverageEnabled:false,onlyIoarr:false,
      useCanon:state.canonAssist,canonPercent:state.canonUsePercent,
      excludeCost:false
    };
  }

  async function getGlpk() {
    if(glpkInstance)return glpkInstance;
    setStatus('Cargando solucionador de programación entera…','working');
    if(typeof window.ESC_V16_GLPK_FACTORY === 'function'){glpkInstance=await window.ESC_V16_GLPK_FACTORY();return glpkInstance;}
    let mod;
    try {mod = await import(GLPK_CDN);} catch (primaryError) {
      console.warn('CDN principal GLPK inaccesible; probando espejo:',primaryError);
      try {mod = await import('https://unpkg.com/glpk.js@4.0.2/dist/index.js');}
      catch (mirrorError) {throw new Error('GLPK no está disponible: fallaron ambos servidores del solucionador. Comprueba la conexión a Internet, el bloqueo de CDN y la consola del navegador.');}
    }
    const initializer = mod.default || mod.GLPK || mod;
    if(typeof initializer!=='function')throw new Error('El componente matemático GLPK no entregó un inicializador compatible.');
    glpkInstance=await initializer();
    if(!glpkInstance || typeof glpkInstance.solve!=='function' || !Number.isFinite(Number(glpkInstance.GLP_OPT)))
      throw new Error('GLPK se cargó de forma incompleta.');
    return glpkInstance;
  }

  function validateAgainstData(result, normRows, params) {
    const allowedIds=new Set(normRows.map(r=>r.cui));
    const seen=new Set(), byPliego=new Map(), byProvince=new Set(), byDistrict=new Set();
    const raw=state.all;
    for(const r of result.rows){
      if(!allowedIds.has(r.cui))throw new Error(`CUI no elegible: ${r.cui}`);
      if(seen.has(r.cui))throw new Error(`Duplicación de CUI: ${r.cui}`);seen.add(r.cui);
      const accumulated=byPliego.get(r.pliego)||0;byPliego.set(r.pliego,accumulated+r.canonApplied);
      if(params.rule.startsWith('pliego') && [...seen].length>0 && result.rows.filter(x=>x.pliego===r.pliego).length>1)throw new Error('Se excedió una IOARR por pliego');
      if(params.rule.startsWith('provincia') && byProvince.has(r.province))throw new Error('Se excedió una IOARR por provincia');
      if(params.rule.startsWith('distrito') && byDistrict.has(r.district))throw new Error('Se excedió una IOARR por distrito');
      byProvince.add(r.province);byDistrict.add(r.district);
    }
    for(const [pliego,canon] of byPliego){const r=normRows.find(r=>r.pliego===pliego);const cap=params.useCanon?r.canonMax*params.canonPercent/100:0;if(canon>cap+0.02)throw new Error('Canon duplicado de pliego');}
    if(result.rows.reduce((s,r)=>s+r.netDeficit,0)>params.budget+0.02)throw new Error('Presupuesto excedido');
    return true;
  }

  function toDashboardRows(rows) {
    return rows.map(r=>({ ...r.ref,_canonApplied:r.canonApplied,_deficitNet:r.netDeficit }));
  }

  // Sustituye la ruta de recomendación incremental de V15.
  generateRecommendation = async function () {
    if(inProgress)return;
    const rawBudget=String($v('budgetInput')?.value||'').trim();
    if(rawBudget && /[a-zA-Z]/.test(rawBudget)){
      setStatus('Introduce el presupuesto en soles (solo cifras), por ejemplo 10000000. No uses «M» ni «millones».','warning');return false;
    }
    const liveBudget=parseMoneyInput(rawBudget);
    if(liveBudget!==state.budget){state.budget=liveBudget;refreshBudgetUi();invalidateRecommendation();simulate();}
    if(!(state.budget>0)){
      setStatus('Define primero el presupuesto total disponible en soles.','warning');
      $v('budgetInput')?.focus();return false;
    }
    if(state.comparisonGoal==='ahp' && !window.EscMulti?.isActive()){
      setStatus('Configura y aplica un modelo AHP antes de optimizar con esa prioridad.','warning');return false;
    }
    const snapshot=currentSnapshot();
    const normalized=normalizedCandidates();
    const params=buildParams();
    if(params.goal==='ahp'){
      const missing=normalized.filter(r=>!Number.isFinite(Number(r.ahpScore)));
      if(missing.length){
        setStatus(`${missing.length} inversiones no tienen puntaje AHP; comprueba la completitud de los criterios activos. No se imputarán puntajes.`, 'warning');
        return false;
      }
    }
    inProgress=true;
    $v('runRecommendation').disabled=true;
    try{
      const glpk=await getGlpk();
      const spec=L.build(normalized,params,glpk);
      if(!spec.empty)setStatus(`Resolviendo ${spec.rows.length} inversiones con variables binarias y canon compartido…`,'working');
      const answer=spec.empty?{result:{status:glpk.GLP_OPT,vars:{},z:0}}:await Promise.resolve(glpk.solve(spec.model,{msglev:glpk.GLP_MSG_OFF,presol:true,tmlim:30000,mipgap:0}));
      const res=L.interpret(spec,answer,params,glpk);
      if(!res.optimal && res.status!=='FACTIBLE_NO_ACREDITADA')throw new Error('El modelo no obtuvo una cartera factible. Comprueba el objetivo y las restricciones.');
      if(snapshot!==currentSnapshot()){
        setStatus('Cambiaste condiciones mientras se resolvía el problema. El resultado anterior se descartó.','warning');return false;
      }
      validateAgainstData(res,normalized,params);
      const resultRows=toDashboardRows(res.rows);
      state.recommendation={rows:resultRows,goal:state.comparisonGoal,baseRule:state.rule,scope:'current',
        scopeLabel:'Respeta las condiciones y regla seleccionadas',goalLabel:$v('comparisonGoal').selectedOptions[0].text,
        optimal:!!res.optimal,solverStatus:res.status,objective:res.objective};
      state.v16Last={rows:resultRows,optimal:res.optimal,objective:res.objective,budget:state.budget,criterion:state.comparisonGoal,
        tested:normalized.length,canon:res.canon??0,used:res.used??0,snapshot};
      state.activeView='manual';
      const label=res.optimal?'Óptimo acreditado por GLPK':'Solución factible; optimalidad NO acreditada';
      const remaining=Math.max(0,params.budget-(res.used||0));
      setStatus(`${label}. ${res.rows.length} IOARR · techo: ${money(params.budget)} · utilizado: ${money(res.used||0)} · saldo: ${money(remaining)}.`,res.optimal?'ok':'warning');
      renderAll();
      return true;
    }catch(error){
      console.error('MILP',error);
      state.v16Last=null;state.recommendation=null;state.activeView='manual';
      setStatus(`Optimización no realizada: ${error.message}. No se obtuvo una cartera financiable acreditada.`, 'error');
      return false;
    }
    finally{inProgress=false;$v('runRecommendation').disabled=false;}
  };

  // Desactiva la matriz incremental anterior. Muestra únicamente la comparación
  // entre condiciones configuradas y el resultado formal del MILP.
  renderComparison = function () {
    const result = $v('v16DecisionResult');if(!result)return;
    if (state.v16Last && state.v16Last.snapshot !== currentSnapshot()) clearStale();
    setVal('compareBudgetBadge',state.budget>0?`Techo: ${fmtCompact(state.budget)}`:'Presupuesto por definir');
    const rec=state.recommendation,last=state.v16Last;
    const candidates=candidatesNow();
    const selected=state.activeView==='recommended'&&rec?rec.rows:recommendedCandidates(candidates,state.rule,'current');
    const method=state.activeView==='recommended'&&rec?'Cartera optimizada':'Candidatas tras aplicar las condiciones';
    const original=selected.length;
    const status=$v('v16SolverStatus');
    state.comparisonResults=[{...comparisonStats(selected,state.rule),label:'Candidatas · sin asignación presupuestal'},
      ...(rec&&last?[{...comparisonStats(last.rows,'priorizada'),label:last.optimal?'Cartera óptima MILP':'Cartera factible MILP'}]:[])];
    if(status && state.v16Status && !inProgress)status.textContent=state.v16Status;
    const label=$v('metricCount')?.closest('article')?.querySelector('span');
    if(label)label.textContent=state.activeView==='recommended'?'IOARR optimizadas':'IOARR candidatas';
    if(!rec||!last){
      result.innerHTML=`<div class="v16-result-empty"><b>${localEsc(method)}</b><span>${fmtInt(original)} candidatas. ${state.budget>0?'Pulsa «Optimizar cartera» para obtener una asignación verificable.':'Ingresa primero un presupuesto para resolver el problema.'}</span></div>`;
      return;
    }
    const finalRows=last.rows;
    const gross=sum(finalRows,'_deficit');const canon=sum(finalRows,'_canonApplied');const used=sum(finalRows,'_deficitNet');
    const beforeIds=new Set(selected.map(r=>r._cui));const afterIds=new Set(finalRows.map(r=>r._cui));
    const additions=finalRows.filter(r=>!beforeIds.has(r._cui));const exclusions=selected.filter(r=>!afterIds.has(r._cui));
    const unique=(rows,key)=>new Set(rows.map(r=>r[key]).filter(Boolean)).size;
    const currentApplied=state.activeView==='recommended';
    result.innerHTML=`<div class="v16-result-header"><div><b>${last.optimal?'Solución óptima demostrada':'Solución factible (sin certificación de óptimo)'}</b><small>${localEsc(rec.goalLabel)} · Misma cartera elegible y mismas restricciones</small></div><button type="button" id="v16ApplyPortfolio" class="v16-apply">${currentApplied?'Volver a candidatas':'Analizar cartera optimizada'}</button></div>
    <div class="v16-kpi-grid"><div><small>IOARR financiables</small><strong>${fmtInt(finalRows.length)}</strong></div><div><small>Puentes</small><strong>${fmtInt(sum(finalRows,'_bridges'))}</strong></div><div><small>Pliegos</small><strong>${fmtInt(unique(finalRows,'_pliego'))}</strong></div><div><small>Distritos</small><strong>${fmtInt(unique(finalRows,'_districtCode'))}</strong></div></div>
    <div class="v16-financing"><div><small>Déficit bruto de la propuesta</small><b>${fmtCompact(gross)}</b></div><div><small>Canon atribuido</small><b>${fmtCompact(canon)}</b></div><div><small>Recursos adicionales</small><b>${fmtCompact(used)}</b></div><div><small>Presupuesto sin usar</small><b>${fmtCompact(Math.max(0,state.budget-used))}</b></div></div>
    <div class="v16-compare-label">Candidatas antes de optimizar: <b>${fmtInt(original)}</b>. La propuesta financia <b>${fmtInt(finalRows.length)}</b>. ${exclusions.length} candidatas no ingresan bajo el presupuesto/objetivo. ${additions.length?'El resultado incluye inversiones diferentes de las actualmente visualizadas.':''}</div>
    <details class="v16-changes"><summary>Ver CUI seleccionados y no seleccionados</summary><div><b>Seleccionados:</b> ${finalRows.slice(0,18).map(r=>r._cui).join(' · ')}${finalRows.length>18?' · …':''}</div><div><b>No incorporados:</b> ${exclusions.slice(0,18).map(r=>r._cui).join(' · ')}${exclusions.length>18?' · …':''}</div></details>`;
    $v('v16ApplyPortfolio')?.addEventListener('click',()=>{state.activeView=currentApplied?'manual':'recommended';simulate();});
  };

  // PCM: administrativo. CENEPRED: riesgo distrital, nunca prueba daño al puente.
  eligibleCondition = function(row) {
    const r={flood:row['NIVEL DE RIESGO POR INUNDACIONES'],mass:row['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA']};
    return (!state.fem||row._fem==='SI') && matchCanonCoverage(row) && L.riskMatches(r,state.riskFilter||'all');
  };

  const oldScenarioCriteria = scenarioCriteria;
  scenarioCriteria=function(){
    const prior=oldScenarioCriteria();
    const parsed=state.v16Last;
    return [['Método de selección presupuestal','Programación entera mixta (MILP), solucionador GLPK.js'],
      ['Estado matemático',parsed?(parsed.optimal?'Óptimo acreditado':'Factible; óptimo no acreditado'):'No optimizada'],
      ['Emergencia PCM',state.fem?'Solo declarados':'Todos'],
      ['CENEPRED inundación/movimientos en masa',({all:'Sin restricción',flood:'Inundación alto/muy alto',mass:'Movimientos alto/muy alto',either:'Al menos un peligro alto/muy alto',both:'Ambos peligros alto/muy alto'})[state.riskFilter]],
      ...prior];
  };

  window.addEventListener('DOMContentLoaded',()=>{
    const ruleSelect=$v('v16RuleSelect');
    ruleSelect?.addEventListener('change',e=>{
      const original=document.querySelector(`input[name="selRule"][value="${e.target.value}"]`);
      if(original){original.checked=true;original.dispatchEvent(new Event('change',{bubbles:true}));}
    });
    const risk=$v('v16Risk');
    risk?.addEventListener('change',e=>{
      state.riskFilter=e.target.value;
      clearStale();simulate();
    });
    $v('resetEsc')?.addEventListener('click',()=>{
      if(risk)risk.value='all';if(ruleSelect)ruleSelect.value='todos';state.riskFilter='all';state.v16Last=null;
      setStatus('Define un presupuesto y pulsa «Optimizar cartera».');
    });
    // No permitir explorar toda la cartera ignorando la regla: V16 respeta condiciones.
    const scope=$v('recommendScope');if(scope)scope.value='current';
    const button=$v('runRecommendation');if(button)button.setAttribute('aria-label','Ejecutar programación entera mixta');
    const cost=$v('costOnlyAlerts');if(cost)cost.title='Solo altera el listado de observaciones, no el conjunto de candidatas.';
  });
  window.ESC_V16={optimized:()=>state.v16Last,engine:'MILP_GLKP_4.0.2',getStatus:()=>state.v16Status};
})();



/* ===== Componente integrado: interfaz v17 ===== */
/* V17 · Orquestador de decisiones: 4 etapas, mapa transversal, AHP, MILP y
 * comparador de escenarios inmutables. Mantiene los motores de V15 y V16.
 * No asigna financiamiento por heurísticas.
 */
'use strict';
(function () {
  const $17=id=>document.getElementById(id);
  const esc17=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const fmt17=n=>Number(n||0).toLocaleString('es-PE',{maximumFractionDigits:0});
  const amt17=n=>`S/ ${(Number(n)||0).toLocaleString('es-PE',{maximumFractionDigits:2})}`;
  const compact17=n=>{const x=Number(n||0);return Math.abs(x)>=1e6?`S/ ${(x/1e6).toLocaleString('es-PE',{maximumFractionDigits:2})} M`:Math.abs(x)>=1e3?`S/ ${(x/1e3).toLocaleString('es-PE',{maximumFractionDigits:1})} mil`:amt17(x);};
  const high17=v=>['ALTO','MUY ALTO'].includes(String(v??'').trim().toUpperCase());
  const storageKey='GMS-LEY32416-V17-ESCENARIOS';
  const ctl={step:1,mapMode:'explore',scenes:[],compareA:'',compareB:'',departments:new Set(),version:'',isReady:false,autoIndex:0};
  const ruleTexts={todos:['Todas las elegibles','Sin limitación por agrupación','bi-collection'],
    pliego_min:['Pliego · menor déficit','Una IOARR de menor déficit por pliego','bi-diagram-2'],
    pliego_max:['Pliego · mayor déficit','Una IOARR de mayor déficit por pliego','bi-diagram-2'],
    provincia_min:['Provincia · menor déficit','Una IOARR de menor déficit por provincia','bi-pin-map'],
    provincia_max:['Provincia · mayor déficit','Una IOARR de mayor déficit por provincia','bi-pin-map'],
    distrito_min:['Distrito · menor déficit','Una IOARR de menor déficit por distrito','bi-grid-3x3'],
    distrito_max:['Distrito · mayor déficit','Una IOARR de mayor déficit por distrito','bi-grid-3x3']};
  const origRowInScope=rowInScope;
  rowInScope=function(row){return origRowInScope(row)&&(!ctl.departments.size||ctl.departments.has(row._regionCode));};
  function liveCandidates(){return state.all.length?candidatesNow():[];}
  function byRuleList(rows,rule){
    if(rule==='todos')return rows;
    const isLarge=rule.endsWith('_max');
    const getter=rule.startsWith('pliego')?r=>r._pliego:rule.startsWith('provincia')?r=>r._provinceCode:r=>r._districtCode;
    return chooseOne(rows,getter,isLarge);
  }
  function goStep(step){
    ctl.step=Math.min(4,Math.max(1,Number(step)||1));
    document.body.classList.toggle('v17-on-step-4',ctl.step===4);
    document.querySelectorAll('[data-v17-stage]').forEach(e=>{const active=Number(e.dataset.v17Stage)===ctl.step;e.hidden=!active;e.classList.toggle('is-visible',active);});
    document.querySelectorAll('[data-v17-go]').forEach(b=>{const ix=Number(b.dataset.v17Go);b.classList.toggle('is-active',ix===ctl.step);b.classList.toggle('is-complete',ix<ctl.step);if(ix===ctl.step)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    if(ctl.step===4){if(ctl.scenes.length>=2)ctl.mapMode='compare';renderOpportunity();}else if(ctl.step===2){ctl.mapMode='explore';}
    const active=document.querySelector(`[data-v17-stage="${ctl.step}"]`);
    if(active)active.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});
    refreshMapMode();
    const caption=$17('v20FlowCaption'),fill=$17('v20FlowFill'),help=$17('v20FlowInstruction');
    if(caption)caption.textContent=`Paso ${ctl.step} de 4 · ${['Definir cartera','Priorizar factores','Optimizar','Comparar y evaluar'][ctl.step-1]}`;
    if(fill)fill.style.width=`${ctl.step*25}%`;
    if(help)help.textContent=['Delimita el universo.','Ajusta los factores AHP.','Obtén y guarda una cartera.','Compara bases equivalentes y descarga.'][ctl.step-1];
  }
  function setDepartments(choices){
    ctl.departments=new Set(choices.filter(Boolean));
    window.ESC_V17_DEPT_CODES=[...ctl.departments].sort();
    invalidateRecommendation();state.v16Last=null;state.activeView='manual';
    simulate(); renderDepartmentChips();
  }
  function departmentNames(){return [...new Map(state.all.map(r=>[r._regionCode,r._region])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'es'));}
  function renderDepartmentChips(){
    const target=$17('v17TerritoryChips');if(!target)return;
    const m=new Map(departmentNames());
    target.innerHTML=ctl.departments.size?[...ctl.departments].map(id=>`<button type="button" data-v17-remove-dept="${esc17(id)}" title="Retirar departamento">${esc17(m.get(id)||id)} <i class="bi bi-x"></i></button>`).join(''):'<span class="v17-muted">Todo el Perú</span>';
  }
  function updateContext(){
    if(!ctl.isReady)return;
    const rows=liveCandidates();
    $17('v17EligibleCount').textContent=fmt17(rows.length);
    $17('v17EligibleDistricts').textContent=fmt17(new Set(rows.map(r=>r._districtCode)).size);
    const rules=[`${rows.length} candidatas`,state.fem?'PCM: declarados':'PCM: todos',
      ({all:'CENEPRED: todos',flood:'Inundación alta',mass:'Movimientos en masa altos',either:'Riesgo alto: alguno',both:'Riesgo alto: ambos'})[state.riskFilter||'all'],
      state.ioarrCondition==='exclude'?'Solo puentes':'Todos los registros',
      state.coverageEnabled?`Cobertura canon ≤ ${state.coverageMax}%`:null,
      ctl.departments.size?`${ctl.departments.size} departamentos`:state.scopeRegion||state.scopeProvince||state.scopeDistrict?'Territorio focalizado':'Perú'];
    const restricted=['mcPovertyMode','mcRiskMode','mcAgriMode'].filter(id=>$17(id)?.value==='restrict');
    if(restricted.length)rules.push(`${restricted.length} restricciones socioeconómicas`);
    if(state.costExclusionMode==='verified')rules.push(`Excluir costos ≥ ${state.costAlertFactor}×`);
    $17('v17ContextChips').innerHTML=rules.filter(Boolean).map(x=>`<span>${esc17(x)}</span>`).join('');
    $17('v17Step1Summary').textContent=`${fmt17(rows.length)} inversiones elegibles · ${fmt17(new Set(rows.map(r=>r._districtCode)).size)} distritos distintos.`;
    renderRuleCards(rows);
    const p=window.EscMulti?.activeProfile();
    $17('v17AhpSummary').innerHTML=p?`<i class="bi bi-check-circle"></i> ${esc17(p.name)} · ${p.keys.length} criterios · CR ${(p.cr*100).toFixed(2)} % · ${rows.filter(r=>r._ahpScore!=null).length} candidatas con puntaje`:
      '<i class="bi bi-info-circle"></i> Sin AHP aplicado · Puedes optimizar por objetivos físicos y territoriales';
    const brief=$17('v20ConditionsSummary');if(brief)brief.textContent=`${fmt17(rows.length)} candidatas · ${fmt17(new Set(rows.map(r=>r._districtCode)).size)} distritos · ${state.fem?'PCM':'Todas las condiciones PCM'}`;
  }
  function renderRuleCards(rows){
    const box=$17('v17RuleCards');if(!box)return;
    const html=Object.entries(ruleTexts).map(([value,[title,description,icon]])=>{
      const filtered=byRuleList(rows,value),districts=new Set(filtered.map(r=>r._districtCode)).size;
      return `<button class="v17-rule-card ${value===state.rule?'is-selected':''}" data-v17-rule="${esc17(value)}" type="button" aria-pressed="${value===state.rule}">
        <i class="bi ${icon}"></i><strong>${esc17(title)}</strong><small>${esc17(description)}</small><em>${fmt17(filtered.length)} CUI · ${fmt17(districts)} distritos</em></button>`;
    }).join('');
    if(box.innerHTML!==html)box.innerHTML=html;
    const previews=$17('v17RulePreview');
    if(previews){
      previews.innerHTML=`<table class="v17-rules-table"><thead><tr><th>Regla</th><th>IOARR</th><th>Puentes</th><th>Distritos</th><th>Brecha bruta</th></tr></thead><tbody>${Object.entries(ruleTexts).map(([key,entry])=>{
        const list=byRuleList(rows,key);
        const bridges=list.reduce((n,r)=>n+r._bridges,0);
        return `<tr data-v17-preview-rule="${esc17(key)}"><td>${esc17(entry[0])}</td><td>${fmt17(list.length)}</td><td>${fmt17(bridges)}</td><td>${fmt17(new Set(list.map(r=>r._districtCode)).size)}</td><td>${compact17(list.reduce((n,r)=>n+r._deficit,0))}</td></tr>`;
      }).join('')}</tbody></table><small>Preselección sin asignación presupuestal. La optimización compara carteras financiables en la etapa 4.</small>`;
    }
    const note=$17('v17RuleNote');if(note)note.textContent=state.rule==='todos'?'La optimización podrá combinar todas las inversiones que cumplan las restricciones.':
      'El menor/mayor déficit fija una candidata por unidad territorial antes del MILP; el presupuesto y el canon se optimizan después.';
  }
  function snapshotState(){
    const ids=['filterFem','v16Risk','excludeCanals','coverageEnabled','coverageMax','mcPovertyMode','mcPovertyQuintile','mcRiskMode','mcRiskHazard','mcAgriMode','mcAgriMin','assistCanon','canonUsePercent','costExclusionMode','costAlertFactor'];
    return {rule:state.rule,budget:state.budget,goal:state.comparisonGoal,
      conditions:Object.fromEntries(ids.map(id=>[id,$17(id)?.type==='checkbox'?$17(id).checked:$17(id)?.value??null])),
      departmentCodes:[...ctl.departments],region:state.scopeRegion,province:state.scopeProvince,district:state.scopeDistrict,pliego:state.scopePliego,
      ahp:window.EscMulti?.activeProfile()?{name:window.EscMulti.activeProfile().name,weights:window.EscMulti.activeProfile().weights,
        keys:window.EscMulti.activeProfile().keys,cr:window.EscMulti.activeProfile().cr}:null};
  }
  function sceneStats(scene){
    const ids=new Set(scene.rows.map(r=>r.cui));
    const byCui=new Map(state.all.map(r=>[r._cui,r]));
    const joined=scene.rows.map(r=>({raw:byCui.get(r.cui),...r})).filter(r=>r.raw);
    const districts=new Map();
    for(const r of joined)if(!districts.has(r.raw._districtCode))districts.set(r.raw._districtCode,r.raw);
    const d=[...districts.values()];
    const total=(field)=>joined.reduce((a,x)=>a+Number(x[field]||0),0);
    const scoreTotal=joined.reduce((a,x)=>a+Number(x.ahpScore??0),0);
    return {n:ids.size,bridges:joined.reduce((s,r)=>s+r.raw._bridges,0),pliegos:new Set(joined.map(r=>r.raw._pliego)).size,
      provincias:new Set(joined.map(r=>r.raw._provinceCode)).size,distritos:d.length,
      vulnerable:d.filter(r=>['PRIMER QUINTIL','SEGUNDO QUINTIL'].includes(String(r['QUINTIL POBREZA']).toUpperCase())).length,
      highRisk:d.filter(r=>high17(r['NIVEL DE RIESGO POR INUNDACIONES'])||high17(r['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA'])).length,
      pcm:joined.filter(r=>r.raw._fem==='SI').length,cost:joined.reduce((s,r)=>s+r.raw._cost,0),
      gross:joined.reduce((s,r)=>s+r.raw._deficit,0),canon:total('canon'),used:total('net'),remaining:Math.max(0,scene.config.budget-total('net')),
      score:scoreTotal,ids};
  }
  function fingerprint(){return `${state.all.length}|${state.all.reduce((s,r)=>s+Math.round(r._deficit),0)}|${state.all.map(r=>r._cui).slice(0,4).join('-')}`;}
  function tryRestore(){
    try{
      const payload=JSON.parse(localStorage.getItem(storageKey)||'null');
      if(payload?.fingerprint!==fingerprint())return;
      ctl.scenes=Array.isArray(payload.scenes)?payload.scenes.slice(0,12):[];
      ctl.autoIndex=Math.max(0,...ctl.scenes.map(s=>Number(s.number)||0));
    }catch(err){console.warn('No fue posible recuperar escenarios guardados:',err);}
  }
  function persist(){
    try{localStorage.setItem(storageKey,JSON.stringify({fingerprint:fingerprint(),scenes:ctl.scenes}));}
    catch(err){console.warn('Escenarios no persistidos:',err);}
  }
  function saveCurrent(auto=false){
    const last=state.v16Last,rec=state.recommendation;
    if(!last?.rows?.length||!rec||last.budget!==state.budget){if(!auto)window.alert('No existe una solución MILP vigente para el presupuesto actual. Optimiza nuevamente antes de guardar.');return null;}
    // No guardar una cartera anterior tras modificar una condición.
    const num=ctl.autoIndex+1;
    const defaultName=`Escenario ${String.fromCharCode(65+((num-1)%26))}`;
    const name=auto?defaultName:(window.prompt('Nombre de la alternativa',defaultName)||'').trim();
    if(!name)return null;
    ctl.autoIndex=num;
    const scene={id:`e${Date.now()}_${num}`,number:num,name,created:new Date().toISOString(),optimal:last.optimal,
      objective:last.objective,criterion:state.comparisonGoal,goalLabel:$17('comparisonGoal')?.selectedOptions?.[0]?.textContent||state.comparisonGoal,
      tested:last.tested,candidateIds:[...new Set(liveCandidates().map(r=>r._cui))].sort(),config:snapshotState(),rows:last.rows.map(r=>({cui:r._cui,canon:Number(r._canonApplied||0),net:Number(r._deficitNet||0),ahpScore:Number.isFinite(r._ahpScore)?r._ahpScore:null}))};
    // Se conserva una cartera completa aun si el usuario cambia posteriormente los controles.
    ctl.scenes.unshift(scene);ctl.scenes=ctl.scenes.slice(0,12);
    ctl.compareB=scene.id;if(ctl.scenes.length>1)ctl.compareA=ctl.scenes[1].id;
    else ctl.compareA=scene.id;
    persist();renderSceneSelectors();renderOpportunity();
    $17('v17SaveScenario').textContent=`Guardado: ${name}`;
    return scene;
  }
  function applySavedScenarioConfig(scene){
    if(!scene?.config)return;
    const config=scene.config;
    // Se recuperan las condiciones de entrada del escenario elegido sin
    // modificar su resultado guardado ni ejecutar una nueva optimización.
    ctl.departments=new Set(config.departmentCodes||[]);
    window.ESC_V17_DEPT_CODES=[...ctl.departments];
    const controls=config.conditions||{};
    for(const [id,value] of Object.entries(controls)){
      const el=$17(id);if(!el||value==null)continue;
      if(el.type==='checkbox')el.checked=Boolean(value);
      else el.value=String(value);
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const rule=$17('v16RuleSelect');if(rule&&config.rule){rule.value=config.rule;rule.dispatchEvent(new Event('change',{bubbles:true}));}
    if(config.goal){const goal=$17('comparisonGoal');if(goal){goal.value=config.goal;goal.dispatchEvent(new Event('change',{bubbles:true}));}}
    const budget=$17('budgetInput');if(budget){budget.value=Number(config.budget||0).toLocaleString('en-US',{maximumFractionDigits:0});budget.dispatchEvent(new Event('change',{bubbles:true}));}
    clearScopes();
    const scopeType=config.district?'district':config.province?'province':config.region?'region':config.pliego?'pliego':null;
    if(scopeType)applyScope(scopeType,config.district||config.province||config.region||config.pliego,true);
    state.mapView=config.district?'district':config.province?'district':config.region?'province':'region';
    renderDepartmentChips();simulate();activateMapView(state.mapView);
    if(window.EscMulti?.restoreScenarioAHP)window.EscMulti.restoreScenarioAHP(config.ahp);
    const note=$17('v20SceneConfigStatus');if(note)note.textContent=`Filtros recuperados de «${scene.name}». La solución guardada no se altera.`;
  }
  function renderPriorityScenes(){
    for(const [id,current] of [['v20PriorityA',ctl.compareA],['v20PriorityB',ctl.compareB]]){
      const el=$17(id);if(!el)return;
      el.innerHTML='<option value="">Elegir escenario...</option>'+ctl.scenes.map(scene=>`<option value="${esc17(scene.id)}">${esc17(scene.name)} · ${scene.rows.length} IOARR</option>`).join('');
      el.value=ctl.scenes.some(s=>s.id===current)?current:'';
    }
    const counter=$17('v20SceneCount');if(counter)counter.textContent=`${ctl.scenes.length} alternativas guardadas`;
    renderPrioritySceneSummary();
  }
  function comparableScenes(a,b){
    if(!a||!b)return {ok:false,why:'Selecciona dos alternativas'};
    const idsA=a.candidateIds,idsB=b.candidateIds;
    if(!Array.isArray(idsA)||!Array.isArray(idsB))return {ok:false,why:'El universo de candidatas no quedó registrado. Vuelve a optimizar y guardar las alternativas con esta versión.'};
    if(idsA.length!==idsB.length||idsA.some((x,i)=>x!==idsB[i]))return {ok:false,why:`Universos distintos (${idsA.length} frente a ${idsB.length} IOARR elegibles). No se puede atribuir la diferencia a la priorización.`};
    if(Math.abs(Number(a.config.budget)-Number(b.config.budget))>.01)return {ok:false,why:'Presupuestos distintos. Para comparar el efecto de los factores, conserva el mismo presupuesto.'};
    const c=a.config.conditions||{},d=b.config.conditions||{};
    const keys=['filterFem','v16Risk','excludeCanals','coverageEnabled','coverageMax','assistCanon','canonUsePercent','costExclusionMode','costAlertFactor'];
    if(keys.some(k=>String(c[k]??'')!==String(d[k]??'')))return {ok:false,why:'Cambian condiciones de elegibilidad o financiación. La diferencia no puede atribuirse solo a los pesos.'};
    if(a.config.rule!==b.config.rule)return {ok:false,why:'Cambió la regla de preselección territorial; estas soluciones solo admiten una comparación descriptiva.'};
    return {ok:true,why:`Base común: ${idsA.length} IOARR candidatas · mismo presupuesto y condiciones`};
  }
  function renderPrioritySceneSummary(){
    const host=$17('v20SceneSummary');if(!host)return;
    const a=ctl.scenes.find(s=>s.id===ctl.compareA),b=ctl.scenes.find(s=>s.id===ctl.compareB);
    if(!a||!b||a.id===b.id){host.textContent='Optimiza y guarda dos alternativas diferentes para comparar cobertura, recursos y criterios.';return;}
    const A=sceneStats(a),B=sceneStats(b);
    const cards=[['IOARR',A.n,B.n],['Puentes',A.bridges,B.bridges],['Provincias',A.provincias,B.provincias],['Distritos',A.distritos,B.distritos],['Inversión adicional',A.used,B.used,'money']];
    host.innerHTML=`<div class="v20-scenes-compare"><div class="v20-scene-title"><b>${esc17(a.name)}</b><span>vs.</span><b>${esc17(b.name)}</b></div>${cards.map(([name,x,y,type])=>`<div class="v20-scene-row"><span>${name}</span><strong>${type==='money'?compact17(x):fmt17(x)}</strong><strong>${type==='money'?compact17(y):fmt17(y)}</strong><em>${type==='money'?compact17(y-x):`${y-x>0?'+':''}${fmt17(y-x)}`}</em></div>`).join('')}</div><p class="v20-scene-caveat">${Math.abs(a.config.budget-b.config.budget)>.01?'Las alternativas tienen techos financieros distintos.':'Mismo techo financiero.'} La comparación presenta resultados de carteras completas, no un ranking CUI por CUI.</p>`;
  }
  function renderSceneSelectors(){
    renderPriorityScenes();
    for(const [id,current] of [['v17CompareA',ctl.compareA],['v17CompareB',ctl.compareB]]){
      const el=$17(id);if(!el)return;
      el.innerHTML='<option value="">Seleccionar alternativa…</option>'+ctl.scenes.map(scene=>`<option value="${esc17(scene.id)}">${esc17(scene.name)} · ${fmt17(scene.rows.length)} CUI</option>`).join('');
      el.value=ctl.scenes.some(s=>s.id===current)?current:'';
    }
  }
  function exportOpportunity(){
    const a=ctl.scenes.find(s=>s.id===ctl.compareA),b=ctl.scenes.find(s=>s.id===ctl.compareB);
    if(!a||!b||a.id===b.id){window.alert('Selecciona dos carteras distintas antes de exportar.');return;}
    const A=sceneStats(a),B=sceneStats(b),output=[['Comparador de escenarios - Ley 32416','','',''],
      ['Indicador','Escenario A: '+a.name,'Escenario B: '+b.name,'Diferencia B-A']];
    const metrics=[['Inversiones seleccionadas','n'],['Puentes comprendidos','bridges'],['Pliegos','pliegos'],
      ['Provincias','provincias'],['Distritos','distritos'],['Distritos pobreza quintiles 1-2','vulnerable'],
      ['Distritos riesgo alto','highRisk'],['IOARR PCM','pcm'],['Costo actualizado S/','cost'],
      ['Deficit bruto S/','gross'],['Canon aplicado S/','canon'],['Presupuesto utilizado S/','used'],
      ['Presupuesto disponible S/','remaining']];
    if(a.config.ahp&&b.config.ahp&&JSON.stringify(a.config.ahp)===JSON.stringify(b.config.ahp))metrics.push(['Puntaje AHP acumulado','score']);
    for(const [label,key] of metrics)output.push([label,A[key],B[key],B[key]-A[key]]);
    output.push([],['Condiciones A','','',''],['Regla',a.config.rule],['Objetivo',a.goalLabel],['Presupuesto S/',a.config.budget],
      ['Condiciones B','','',''],['Regla',b.config.rule],['Objetivo',b.goalLabel],['Presupuesto S/',b.config.budget],
      [],['Estado del CUI','CUI','Region','Distrito']);
    const source=new Map(state.all.map(r=>[r._cui,r]));
    const diff=[...[...B.ids].filter(id=>!A.ids.has(id)).map(id=>['Ingresa a B',id]),
      ...[...A.ids].filter(id=>!B.ids.has(id)).map(id=>['Sale de A',id])];
    for(const [status,id] of diff){const r=source.get(id);output.push([status,id,r?._region||'',r?.distrito||'']);}
    const quote=v=>`"${String(v??'').replaceAll('"','""')}"`;
    const csv='\uFEFF'+output.map(row=>row.map(quote).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='comparacion_escenarios_ley32416_v17.csv';
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function val(row,field){return Number(row?.[field]||0);}
  function renderOpportunity(){
    const a=ctl.scenes.find(s=>s.id===ctl.compareA),b=ctl.scenes.find(s=>s.id===ctl.compareB);
    const status=$17('v17CompareStatus'),tb=$17('v17OpportunityBody'),changes=$17('v17Changes'),chart=$17('v17TradeoffChart'),readout=$17('v17ExecutiveReadout');
    if(!status||!tb)return;
    if(!a||!b||a.id===b.id){
      status.className='v17-compare-status';status.textContent=ctl.scenes.length<2?'Guarda dos alternativas optimizadas sobre las mismas candidatas y presupuesto para comparar sus resultados.':'Elige dos escenarios distintos.';
      tb.innerHTML='<tr><td colspan="4">Selecciona dos escenarios distintos para visualizar la matriz.</td></tr>';
      if(changes)changes.textContent='Sin comparación activa.';if(chart)chart.textContent='Sin comparación activa.';if(readout)readout.textContent='';refreshMapMode();return;
    }
    const A=sceneStats(a),B=sceneStats(b);
    const comparison=comparableScenes(a,b);
    const comparableAHP=!!(a.config.ahp&&b.config.ahp&&JSON.stringify(a.config.ahp)===JSON.stringify(b.config.ahp));
    status.className=`v17-compare-status ${comparison.ok?'':'is-warning'}`;
    status.innerHTML=`<b>${comparison.ok?'Comparación sobre una misma base':'Comparación NO equivalente'}</b> · ${esc17(comparison.why)}. Se muestran coberturas relativas, sin elegir automáticamente un ganador.`;
    const commonBase=comparison.ok?a.candidateIds.length:null;
    const ratio=(x,n)=>n?`${(x/n*100).toLocaleString('es-PE',{maximumFractionDigits:1})} %`:'—';
    const perHundred=(x,n)=>n?`${(x/n*100).toLocaleString('es-PE',{maximumFractionDigits:1})}`:'—';
    const extra=[
      ['Cobertura de candidatas',ratio(A.n,commonBase),ratio(B.n,commonBase),'Mismo universo requerido'],
      ['Distritos vulnerables / distritos seleccionados',ratio(A.vulnerable,A.distritos),ratio(B.vulnerable,B.distritos),'Proporción territorial'],
      ['Distritos con riesgo alto / distritos seleccionados',ratio(A.highRisk,A.distritos),ratio(B.highRisk,B.distritos),'Proporción territorial'],
      ['IOARR en emergencia / IOARR seleccionadas',ratio(A.pcm,A.n),ratio(B.pcm,B.n),'Proporción administrativa'],
      ['Distritos por 100 IOARR seleccionadas',perHundred(A.distritos,A.n),perHundred(B.distritos,B.n),'Intensidad territorial'],
      ['Puentes por IOARR',A.n?(A.bridges/A.n).toFixed(2):'—',B.n?(B.bridges/B.n).toFixed(2):'—','Promedio por inversión'],
      ['Financiamiento por IOARR',A.n?compact17(A.used/A.n):'—',B.n?compact17(B.used/B.n):'—','Costo financiero medio']
    ];
    const metrics=[['IOARR seleccionadas','n','integer'],['Puentes comprendidos','bridges','integer'],['Pliegos distintos','pliegos','integer'],
      ['Provincias únicas','provincias','integer'],['Distritos únicos','distritos','integer'],['Distritos pobreza quintiles 1–2','vulnerable','integer'],
      ['Distritos riesgo alto CENEPRED','highRisk','integer'],['IOARR en emergencia PCM','pcm','integer'],
      ['Costo actualizado','cost','money'],['Déficit bruto seleccionado','gross','money'],['Canon aplicado','canon','money'],
      ['Financiamiento adicional usado','used','money'],['Presupuesto disponible','remaining','money'],
      ['Puntaje AHP acumulado','score','score']];
    const f=(n,type)=>type==='money'?compact17(n):type==='score'?Number(n||0).toLocaleString('es-PE',{maximumFractionDigits:1}):fmt17(n);
    tb.innerHTML=extra.map(([title,x,y,detail])=>`<tr class="esc-normalized-row"><td>${esc17(title)}</td><td>${esc17(x)}</td><td>${esc17(y)}</td><td>${esc17(detail)}</td></tr>`).join('')+metrics.map(([title,key,type])=>{
      if(key==='score'&&!comparableAHP)return `<tr><td>${esc17(title)}</td><td>—</td><td>—</td><td>No comparable sin el mismo AHP</td></tr>`;
      const d=B[key]-A[key];const sign=d>1e-5?'+':'';
      return `<tr><td>${esc17(title)}</td><td>${f(A[key],type)}</td><td>${f(B[key],type)}</td><td class="v17-delta">${sign}${f(d,type)}</td></tr>`;
    }).join('');
    const added=[...B.ids].filter(id=>!A.ids.has(id));const removed=[...A.ids].filter(id=>!B.ids.has(id));
    const common=[...A.ids].filter(id=>B.ids.has(id));
    changes.innerHTML=`<div class="v17-diff-list"><div><b>Ingresan en B:</b> ${fmt17(added.length)}</div><div>${added.length?added.slice(0,25).map(id=>`<code>${esc17(id)}</code>`).join(''):'Sin ingresos'}</div><div><b>Salen de A:</b> ${fmt17(removed.length)}</div><div>${removed.length?removed.slice(0,25).map(id=>`<code>${esc17(id)}</code>`).join(''):'Sin salidas'}</div><div><b>Compartidos:</b> ${fmt17(common.length)} CUI</div></div>`;
    const bars=[['Puentes',A.bridges,B.bridges],['Distritos',A.distritos,B.distritos],['Pliegos',A.pliegos,B.pliegos]];
    chart.innerHTML=bars.map(([name,x,y])=>{
      const mx=Math.max(1,x,y);return `<div class="v17-bar-row"><span><b>${esc17(name)}</b> A ${fmt17(x)} · B ${fmt17(y)}</span><div class="v17-bar-track"><div class="v17-bar-fill" style="width:${Math.min(100,x/mx*100)}%"></div></div><div class="v17-bar-track" style="margin-top:3px"><div class="v17-bar-fill is-b" style="width:${Math.min(100,y/mx*100)}%"></div></div></div>`;
    }).join('');
    const diffs=[['IOARR',B.n-A.n],['puentes',B.bridges-A.bridges],['distritos',B.distritos-A.distritos],['pliegos',B.pliegos-A.pliegos]];
    readout.innerHTML=comparison.ok
      ?`<b>Lectura bajo condiciones equivalentes:</b> A selecciona ${ratio(A.n,commonBase)} de las candidatas; B selecciona ${ratio(B.n,commonBase)}. A: ${perHundred(A.distritos,A.n)} distritos por 100 IOARR; B: ${perHundred(B.distritos,B.n)}. La decisión depende de cobertura, necesidades territoriales y recursos, no únicamente del número bruto de IOARR.`
      :`<b>No es válido declarar una alternativa superior.</b> ${esc17(comparison.why)}. Las diferencias siguientes son descriptivas; guarda escenarios sobre el mismo universo, presupuesto y restricciones para evaluar la priorización.`;
    refreshMapMode();
  }
  function updateMapOverlay(){
    if(!state.mapReady)return;
    if(ctl.mapMode!=='compare'){
      const current=escLayerCache.get(state.mapView);
      if(current)for(const shape of current.paths.values())shape.classList.remove('v17-a-only','v17-b-only','v17-shared','v17-neither');
      return;
    }
    const a=ctl.scenes.find(s=>s.id===ctl.compareA),b=ctl.scenes.find(s=>s.id===ctl.compareB);
    if(!a||!b||a.id===b.id||!comparableScenes(a,b).ok){const existing=escLayerCache.get(state.mapView);if(existing)for(const shape of existing.paths.values())shape.classList.remove('v17-a-only','v17-b-only','v17-shared','v17-neither');return;}
    const source=new Map(state.all.map(r=>[r._cui,r]));
    const field=state.mapView==='region'?'_regionCode':state.mapView==='province'?'_provinceCode':'_districtCode';
    const A=new Set(a.rows.map(r=>source.get(r.cui)?.[field]).filter(Boolean)),B=new Set(b.rows.map(r=>source.get(r.cui)?.[field]).filter(Boolean));
    const layer=escLayerCache.get(state.mapView);if(!layer)return;
    for(const [code,shape] of layer.paths){const x=A.has(code),y=B.has(code);shape.classList.remove('v17-a-only','v17-b-only','v17-shared','v17-neither');
      shape.classList.add(x&&y?'v17-shared':x?'v17-a-only':y?'v17-b-only':'v17-neither');}
  }
  const prevPaint=paintMapNow;
  paintMapNow=function(){prevPaint();updateMapOverlay();};
  function refreshMapMode(){
    document.querySelectorAll('[data-v17-map-mode]').forEach(b=>b.classList.toggle('is-active',b.dataset.v17MapMode===ctl.mapMode));
    const layer=$17('mcMapLayer'),hint=$17('v17MapModeHint');if(!layer||!hint)return;
    if(ctl.mapMode==='compare'){
      const scA=ctl.scenes.find(s=>s.id===ctl.compareA),scB=ctl.scenes.find(s=>s.id===ctl.compareB);
      if(!comparableScenes(scA,scB).ok){hint.textContent='Comparación cartográfica desactivada: los escenarios no comparten una base de análisis equivalente.';layer.value='selected';updateMap();return;}
      layer.value='selected';hint.innerHTML='<b>Comparación territorial:</b> <span style="color:#b57747">■</span> Solo A · <span style="color:#427d9d">■</span> Solo B · <span style="color:#963b63">■</span> Ambas. Los colores representan presencia de inversiones, no nivel de riesgo.';
    }else if(ctl.mapMode==='result'){
      if(!state.recommendation&&state.activeView!=='recommended')hint.textContent='Aún no hay una cartera optimizada activa. Optimiza para mostrar la propuesta.';
      else hint.textContent='Mapa de la cartera optimizada. Puedes seleccionar distrito, provincia o región y consultar el detalle.';
    }else hint.textContent='Explora las capas de PCM, CENEPRED, pobreza, agricultura, canon y selección. Los atributos de riesgo son distritales.';
    updateMap();
  }
  function extendMapLayers(){
    const select=$17('mcMapLayer');
    for(const [v,label] of [['pcm','Declaratoria de emergencia PCM'],['canon','Canon registrado por pliego (referencial)']]){
      if(!select.querySelector(`option[value="${v}"]`)){const o=document.createElement('option');o.value=v;o.textContent=label;select.appendChild(o);}
    }
    const oldStyle=window.EscMulti.mapStyle,oldTooltip=window.EscMulti.tooltip;
    const memo=new Map();let customLegendKey='';
    function summaryValue(mode,key,theme){
      const cacheKey=mode+'-'+theme;
      let cache=memo.get(cacheKey);
      if(!cache||cache.rows!==state.scenario){
        const groups=new Map();
        for(const r of state.scenario){
          const k=mode==='district'?r._districtCode:mode==='province'?r._provinceCode:r._regionCode;
          if(!groups.has(k))groups.set(k,{n:0,pcm:0,pliegos:new Map()});
          const t=groups.get(k);t.n++;if(r._fem==='SI')t.pcm++;
          if(!t.pliegos.has(r._pliego))t.pliegos.set(r._pliego,canonAmountForPliego(r._pliego));
        }
        const values=new Map();
        for(const [key,g] of groups)values.set(key,theme==='pcm'?100*g.pcm/g.n:[...g.pliegos.values()].reduce((a,b)=>a+b,0));
        cache={rows:state.scenario,values,max:Math.max(1,...values.values())};memo.set(cacheKey,cache);
      }
      return cache.values.get(key)??null;
    }
    function themeMaximum(mode,theme){
      const values=[...new Set(state.scenario.map(r=>mode==='district'?r._districtCode:mode==='province'?r._provinceCode:r._regionCode))];
      let mx=1;for(const key of values)mx=Math.max(mx,summaryValue(mode,key,theme)||0);return mx;
    }
    window.EscMulti.mapStyle=function(mode,code){
      const theme=select.value;if(!['pcm','canon'].includes(theme)){customLegendKey='';return oldStyle(mode,code);}
      const lk=`${mode}:${theme}:${state.scenario?.length}`;
      if(lk!==customLegendKey){customLegendKey=lk;
        const title=theme==='pcm'?'Declaratoria de emergencia PCM':'Canon de los pliegos';
        const desc=theme==='pcm'?'Porcentaje de IOARR declaradas en emergencia en el territorio.':'Canon registrado de pliegos vinculados a las inversiones del territorio.';
        $17('mcMapLegend').textContent=desc;
        const story=$17('v20MapStory');if(story)story.innerHTML=`<strong>${title}</strong><span>${desc}</span>`;
        const legend=$17('v18HeatLegend');if(legend){const max=themeMaximum(mode,theme);legend.hidden=false;legend.innerHTML=`<strong>${title}</strong><div class="v20-gradient"><span>0 ${theme==='pcm'?'%':'S/'}</span><i></i><span>${theme==='pcm'?'100 %':compact17(max)}</span></div>`;}
        document.querySelector('.esc-map-footer')?.setAttribute('hidden','');
      }
      const value=summaryValue(mode,code,theme);
      if(value==null)return {fill:'#e8edf1',value:null};
      const c=memo.get(mode+'-'+theme);
      const ratio=theme==='pcm'?Math.min(1,value/100):Math.min(1,Math.sqrt(value/Math.max(1,c?.max||1)));
      const light=Math.round(88-46*ratio);
      return {fill:`hsl(341 59% ${light}%)`,value};
    };
    window.EscMulti.tooltip=function(mode,code){
      const theme=select.value;if(!['pcm','canon'].includes(theme))return oldTooltip(mode,code);
      const n=summaryValue(mode,code,theme);return `<div class="esc-mc-map-info"><b>${n==null?'Sin información':theme==='pcm'?`${n.toFixed(0)} % de IOARR con declaratoria PCM`:`${compact17(n)} de canon registrado`}</b></div>`;
    };
    // Las capas reflejan magnitudes territoriales de la cartera, sin localización física supuesta.
    select.addEventListener('change',()=>{
      const legend=$17('mcMapLegend');
      if(legend){
        if(select.value==='pcm')legend.textContent='Proporción de inversiones comprendidas en declaratoria PCM; no indica el nivel de riesgo CENEPRED.';
        else if(select.value==='canon')legend.textContent='Canon referencial compartido por pliego. Un mismo pliego puede aparecer en varios distritos: no sumar los valores entre territorios ni confundirlos con canon asignado.';
      }
      if(ctl.mapMode==='compare'){ctl.mapMode='explore';refreshMapMode();}
    });
  }
  const originalRenderAll=renderAll;
  renderAll=function(){originalRenderAll();if(ctl.isReady)updateContext();};
  const originalOptimize=generateRecommendation;
  generateRecommendation=async function(){
    const prior=state.v16Last;
    const success=await originalOptimize();
    if(success===true&&state.v16Last&&state.v16Last!==prior&&state.recommendation){
      state.activeView='recommended';simulate();
      const scene=saveCurrent(true);
      if(scene){$17('v17SaveScenario').innerHTML=`<i class="bi bi-check-circle"></i> ${esc17(scene.name)} guardado`;
        const current=$17('v16SolverStatus');if(current)current.title='Se guardó automáticamente una copia para comparación. Puedes crear nuevas alternativas cambiando las condiciones.';}
      ctl.mapMode='result';refreshMapMode();
    }
    return success===true;
  };
  function init(){
    ctl.version=fingerprint();
    window.ESC_V17_DEPT_CODES=[];
    tryRestore();renderSceneSelectors();
    const regionSelect=$17('v17DepartmentSelector');
    for(const [code,name] of departmentNames()){const o=document.createElement('option');o.value=code;o.textContent=name;regionSelect.appendChild(o);}
    $17('v17AddDepartment').addEventListener('click',()=>{const v=regionSelect.value;if(v)setDepartments([...ctl.departments,v]);});
    $17('v17ClearDepartments').addEventListener('click',()=>setDepartments([]));
    $17('v17TerritoryChips').addEventListener('click',e=>{const b=e.target.closest('[data-v17-remove-dept]');if(b)setDepartments([...ctl.departments].filter(x=>x!==b.dataset.v17RemoveDept));});
    $17('v17RuleCards').addEventListener('click',e=>{const b=e.target.closest('[data-v17-rule]');if(!b)return;const original=$17('v16RuleSelect');original.value=b.dataset.v17Rule;original.dispatchEvent(new Event('change',{bubbles:true}));});
    $17('v17AhpLaunch')?.addEventListener('click',()=>$17('mcOpenAhp')?.click());
    document.querySelectorAll('[data-v17-go],[data-v17-prev],[data-v17-next]').forEach(btn=>btn.addEventListener('click',()=>goStep(btn.dataset.v17Go||btn.dataset.v17Prev||btn.dataset.v17Next)));
    document.querySelectorAll('[data-v17-map-mode]').forEach(btn=>btn.addEventListener('click',()=>{ctl.mapMode=btn.dataset.v17MapMode;if(ctl.mapMode==='result'&&state.recommendation){state.activeView='recommended';simulate();}
      if(ctl.mapMode==='explore'&&state.activeView==='recommended'){state.activeView='manual';simulate();}refreshMapMode();}));
    $17('v17SaveScenario').addEventListener('click',()=>saveCurrent(false));
    for(const [id,key] of [['v20PriorityA','compareA'],['v20PriorityB','compareB']])$17(id)?.addEventListener('change',e=>{ctl[key]=e.target.value;const scene=ctl.scenes.find(s=>s.id===e.target.value);if(key==='compareA'&&scene)applySavedScenarioConfig(scene);renderPrioritySceneSummary();renderSceneSelectors();renderOpportunity();});
    $17('v20CompareGo')?.addEventListener('click',()=>{ctl.compareA=$17('v20PriorityA').value;ctl.compareB=$17('v20PriorityB').value;renderPrioritySceneSummary();ctl.mapMode='compare';refreshMapMode();renderOpportunity();});
    $17('v20ToCompareStep')?.addEventListener('click',()=>goStep(4));
    $17('v17ExportCompare').addEventListener('click',exportOpportunity);
    for(const [id,key] of [['v17CompareA','compareA'],['v17CompareB','compareB']])$17(id).addEventListener('change',e=>{ctl[key]=e.target.value;ctl.mapMode='compare';renderOpportunity();refreshMapMode();});
    $17('v17SwapCompare').addEventListener('click',()=>{[ctl.compareA,ctl.compareB]=[ctl.compareB,ctl.compareA];renderSceneSelectors();renderOpportunity();});
    $17('v17DeleteScene').addEventListener('click',()=>{if(!ctl.compareB)return;ctl.scenes=ctl.scenes.filter(s=>s.id!==ctl.compareB);ctl.compareB=ctl.scenes[0]?.id||'';ctl.compareA=ctl.scenes[1]?.id||'';persist();renderSceneSelectors();renderOpportunity();});
    $17('v17GoStart').addEventListener('click',()=>{ctl.mapMode='explore';goStep(1);});
    $17('resetEsc').addEventListener('click',()=>{ctl.departments.clear();window.ESC_V17_DEPT_CODES=[];ctl.mapMode='explore';renderDepartmentChips();goStep(1);});
    $17('filterFem').closest('.esc-switch')?.setAttribute('title','PCM: condición administrativa de declaratoria; independiente del riesgo CENEPRED.');
    extendMapLayers();
    ctl.isReady=true;renderDepartmentChips();updateContext();refreshMapMode();renderPriorityScenes();
    if(ctl.scenes.length){ctl.compareA=ctl.scenes[1]?.id||ctl.scenes[0].id;ctl.compareB=ctl.scenes[0].id;renderSceneSelectors();renderOpportunity();}
  }
  // La función load de escenarios.js es async: esperar su finalización sin alterar su promesa.
  window.addEventListener('DOMContentLoaded',()=>{
    let tries=0;
    const check=()=>{
      if(ctl.isReady)return;
      if(state.all.length){init();return;}
      if(++tries<100)setTimeout(check,100);
      else console.error('V17: no se pudo inicializar la cartera');
    };
    check();
  });
  window.ESC_V17={goStep,renderOpportunity,saveCurrent,comparable:comparableScenes,scenes:()=>ctl.scenes,preview:()=>liveCandidates().length,restore:()=>ctl.scenes,
    compare:(a,b)=>{ctl.compareA=a;ctl.compareB=b;renderSceneSelectors();renderOpportunity();}};
})();



/* ===== Componente integrado: interfaz v18 ===== */
/* V18 · Secuencia de decisión, matriz de criterios, escenarios MILP y sensibilidad.
 * Extiende V17 sin reemplazar el motor GLPK ni crear datos nuevos.
 */
'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const fmt=n=>Number(n||0).toLocaleString('es-PE',{maximumFractionDigits:0});
 const amt=n=>`S/ ${(Number(n||0)/1e6).toLocaleString('es-PE',{maximumFractionDigits:2})} M`;
 const keyText={poverty:'Ranking de pobreza distrital',agriculture:'Superficie agrícola distrital',flood:'Riesgo por inundaciones',mass:'Riesgo por movimientos en masa'};
 const rowsCfg=[
  ['1 · Inversión','Cantidad de puentes','n_puentes',null,'Objetivo físico'],
  ['1 · Inversión','Déficit financiero calculado','deficit',null,'Restricción presupuestal'],
  ['2 · Administración','Declaratoria de emergencia PCM','DECLARATORIA DE EMERGENCIA PCM',null,'Condición administrativa'],
  ['2 · Administración','Canon por pliego','CANON',null,'Financiamiento compartido'],
  ['3 · Contexto distrital',keyText.poverty,'RANKING POBREZA','poverty','AHP / Focalización'],
  ['3 · Contexto distrital','Quintil de pobreza','QUINTIL POBREZA',null,'Contexto; no duplicar ranking'],
  ['3 · Contexto distrital',keyText.agriculture,'AREA AGRICOLA','agriculture','AHP / Focalización'],
  ['3 · Contexto distrital',keyText.flood,'NIVEL DE RIESGO POR INUNDACIONES','flood','AHP / Restricción'],
  ['3 · Contexto distrital',keyText.mass,'NIVEL DE RIESGO POR MOVIMIENTOS DE MASA','mass','AHP / Restricción'],
  ['4 · Exposición distrital','Viviendas en áreas susceptibles a inundaciones','VIVIENDAS EN AREAS DE MAYOR SUSCEPTIBILIDAD INUNDACIONES',null,'Diagnóstico; no beneficio del puente'],
  ['4 · Exposición distrital','Viviendas en áreas susceptibles a movimientos en masa','VIVIENDAS EN AREAS DE MAYOR SUSCEPTIBILIDAD MOVIMIENTOS DE MASA',null,'Diagnóstico; no beneficio del puente']
 ];
 let ready=false,working=false; const warnings=[];
 function sample(){return typeof candidatesNow==='function'?candidatesNow():state.eligible;}
 function activeCriteria(){return [...document.querySelectorAll('[data-mc-criterion]:checked')].map(x=>x.dataset.mcCriterion);}
 function renderMatrix(){if(!ready)return;
  const rows=sample(),active=new Set(activeCriteria());
  $('v18CriteriaBody').innerHTML=rowsCfg.map(([level,title,field,crit,role])=>{
   const complete=rows.filter(r=>r[field]!==null&&r[field]!==undefined&&r[field]!==''),n=complete.length;
   return `<tr><td class="v18-criterion-level">${esc(level)}</td><td><b>${esc(title)}</b><small>${esc(field)}</small></td><td><div class="v18-data-bar"><span style="width:${rows.length?n/rows.length*100:0}%"></span></div>${fmt(n)} / ${fmt(rows.length)}</td><td>${crit?`<label class="v18-crit-switch"><input data-v18-criterion="${crit}" type="checkbox" ${active.has(crit)?'checked':''}><span>Usar</span></label>`:'<span class="v18-no-weight">—</span>'}</td><td>${esc(role)}</td></tr>`;
  }).join('');
  $('v18CriteriaStatus').innerHTML=`<b>${active.size} criterios activos</b> · Con iguales juicios, AHP parte de pesos equivalentes. Para distinguir su importancia abre las comparaciones Saaty. Los totales distritales no se multiplican por CUI.`;
 }
 function syncCriteria(key,checked){const input=document.querySelector(`[data-mc-criterion="${key}"]`);if(!input)return;input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));renderMatrix();}
 function updateStatus(){if(!ready)return;
  renderMatrix();
  const riskLayer=$('mcMapLayer')?.value;
  // La leyenda se genera dinámicamente para todas las capas en EscMulti.mapLayerConfig().
  // Actualizar KPI altos al mismo tiempo que los filtros.
  const rows=sample(),eligible=$('baseEligible'),base=$('baseDeficit');if(eligible){eligible.textContent=fmt(rows.length);eligible.title='CUI con déficit financiable que cumplen las condiciones activas';}if(base){base.textContent=amt(rows.reduce((s,r)=>s+r._deficit,0));base.title='Brecha original de las inversiones candidatas que cumplen las condiciones activas';}
 }
 function bindInputs(){
  $('v18CriteriaBody').addEventListener('change',e=>{const key=e.target.dataset.v18Criterion;if(key)syncCriteria(key,e.target.checked);});
  $('v18EqualWeights').addEventListener('click',()=>{
    const keys=activeCriteria();if(keys.length<2){$('v18CriteriaStatus').textContent='Selecciona al menos dos criterios de AHP.';return;}
    window.EscMulti?.resetEqualWeights?.();$('v18OpenAHP').click();
    $('v18CriteriaStatus').textContent='Todas las comparaciones restablecidas a igual importancia (1:1).';
  });
  $('v18OpenAHP').addEventListener('click',()=>$('mcOpenAhp').click());
  document.querySelectorAll('[data-mc-criterion]').forEach(c=>c.addEventListener('change',renderMatrix));
  $('v18RunGoals').addEventListener('click',runGoals);
  $('v18RunSensitivity').addEventListener('click',runSensitivity);
  ['mcMapLayer','filterFem','v16Risk','coverageEnabled','coverageMax','mcPovertyMode','mcRiskMode','mcAgriMode','costExclusionMode','assistCanon','canonUsePercent','excludeCanals'].forEach(id=>{
    $(id)?.addEventListener('change',()=>requestAnimationFrame(updateStatus));
  });
  document.querySelectorAll('[data-map-view]').forEach(x=>x.addEventListener('click',()=>setTimeout(updateStatus,0)));
 }
 const stats=()=>{
  const last=state.v16Last,rows=last?.rows||[];
  return {ioarr:rows.length,puentes:rows.reduce((s,r)=>s+r._bridges,0),districts:new Set(rows.map(r=>r._districtCode)).size,used:rows.reduce((s,r)=>s+Number(r._deficitNet||0),0),status:last?.optimal?'Óptimo':last?'Factible':'No resuelto'};
 };
 async function solveWithGoal(goal){const select=$('comparisonGoal');select.value=goal;select.dispatchEvent(new Event('change',{bubbles:true}));
  await generateRecommendation();if(!state.v16Last?.rows||!state.recommendation)throw new Error('No se obtuvo cartera matemáticamente válida; revisa el estado del solucionador.');
  return stats();
 }
 async function runGoals(){if(working)return;
  const aims=[...document.querySelectorAll('#v18GoalChecks input:checked')].map(x=>x.value);
  const output=$('v18GoalMatrix'),note=$('v18GoalProgress');
  if(aims.length<2){note.textContent='Selecciona como mínimo dos objetivos para comparar.';return;}
  if(!state.budget){note.textContent='Establece el presupuesto externo antes de evaluar objetivos.';return;}
  if(aims.includes('ahp')&&!window.EscMulti?.isActive()){note.textContent='Configura y aplica AHP antes de evaluar la función objetivo multicriterio.';return;}
  const original=$('comparisonGoal').value;
  working=true;$('v18RunGoals').disabled=true;output.innerHTML='';
  try{
   for(let i=0;i<aims.length;i++){
    const goal=aims[i];note.textContent=`Resolviendo objetivo ${i+1} de ${aims.length}: ${goal}…`;
    await new Promise(r=>setTimeout(r,35));
    try {const x=await solveWithGoal(goal);
      output.insertAdjacentHTML('beforeend',`<tr><td><b>${esc($('comparisonGoal').selectedOptions[0].text)}</b></td><td class="v18-solved">${x.status}</td><td>${fmt(x.ioarr)}</td><td>${fmt(x.puentes)}</td><td>${fmt(x.districts)}</td><td>${amt(x.used)}</td></tr>`);
    }catch(error){output.insertAdjacentHTML('beforeend',`<tr><td>${esc(goal)}</td><td class="v18-error" colspan="5">${esc(error.message)}</td></tr>`);if(String(error.message).includes('GLPK'))break;}
   }
   note.textContent='Resultados guardados en el comparador de alternativas. Compara objetivos con el mismo presupuesto y las mismas restricciones.';
  }finally {working=false;$('v18RunGoals').disabled=false;}
 }
 async function runSensitivity(){if(working)return;
  const status=$('v18SensitivityStatus'),bf=Number($('v18SensitivityBudget').value),canon=$('v18SensitivityCanon').value;
  if(!state.budget){status.textContent='Configura primero un presupuesto positivo en la etapa 3.';return;}
  if(!state.v16Last){status.textContent='Obtén al menos una cartera optimizada antes de realizar la sensibilidad.';return;}
  const old={budget:state.budget,canon:state.canonAssist,percentage:state.canonUsePercent};
  const newBudget=Math.round(old.budget*bf);
  if(bf===1&&canon==='same'){status.textContent='Selecciona una variación en presupuesto o canon para ejecutar sensibilidad.';return;}
  working=true;$('v18RunSensitivity').disabled=true;
  try{
   $('budgetInput').value=newBudget.toLocaleString('en-US');$('budgetInput').dispatchEvent(new Event('change',{bubbles:true}));
   if(canon!=='same'){
    $('assistCanon').checked=Number(canon)>0;$('assistCanon').dispatchEvent(new Event('change',{bubbles:true}));
    $('canonUsePercent').value=canon;$('canonUsePercent').dispatchEvent(new Event('input',{bubbles:true}));
   }
   status.textContent=`Calculando con ${amt(newBudget)} de presupuesto y ${canon==='same'?'canon original':canon+' % del canon'}…`;
   await new Promise(r=>setTimeout(r,35));
   await generateRecommendation();
   if(state.v16Last){const x=stats();status.textContent=`Nueva alternativa guardada: ${fmt(x.ioarr)} IOARR, ${fmt(x.puentes)} puentes, ${amt(x.used)} de presupuesto utilizado. Evalúa las diferencias en la matriz superior.`;}
  }catch(err){status.textContent=`No fue posible acreditar el resultado: ${err.message}`;}
  finally{
   // Restituye los controles de la comparación sin generar otra cartera;
   // los resultados anteriores permanecen guardados en el comparador.
   $('budgetInput').value=old.budget.toLocaleString('en-US');$('budgetInput').dispatchEvent(new Event('change',{bubbles:true}));
   $('assistCanon').checked=old.canon;$('assistCanon').dispatchEvent(new Event('change',{bubbles:true}));
   $('canonUsePercent').value=old.percentage;$('canonUsePercent').dispatchEvent(new Event('input',{bubbles:true}));
   working=false;$('v18RunSensitivity').disabled=false;
  }
 }
 function improveMatrix(){const tbody=$('v17OpportunityBody');if(!tbody)return;
  for(const tr of tbody.querySelectorAll('tr')){const cells=tr.querySelectorAll('td');if(cells.length<4)continue;
   const value=Number(cells[3].textContent.replace(/[S/,\s+M]/g,'').replace(',','.'));
   // La direccionalidad no es universal: saldo, gasto y número de IOARR tienen significados distintos.
   // Solo colorear explícitamente indicadores de cobertura con orientación clara.
   const label=cells[0].textContent.toLowerCase();
   if(!/inversiones seleccionadas|puentes comprendidos|pliegos distintos|provincias|distritos únicos|distritos pobreza|distritos riesgo/i.test(label))continue;
   const raw=cells[3].textContent.replaceAll('.','').replace(',','.').match(/[-+]?\d+(\.\d+)?/);
   if(!raw)continue;
   const n=Number(raw[0]);cells[3].classList.toggle('v18-better',n>0);cells[3].classList.toggle('v18-worse',n<0);
  }
 }
 function init(){if(ready)return;
  ready=true;
  // En universo inicial solo las IOARR verificadas. La condición de riesgo se configura después.
  const e=$('excludeCanals');if(e&&!e.checked){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}
  else if(state.ioarrCondition!=='exclude'){state.ioarrCondition='exclude';invalidateRecommendation();simulate();}
  bindInputs();renderMatrix();updateStatus();
  const mo=new MutationObserver(()=>{if(ready)improveMatrix();});mo.observe($('v17OpportunityBody'),{childList:true});
 }
 window.addEventListener('DOMContentLoaded',()=>{let tries=0;const timer=setInterval(()=>{if(state.all?.length&&window.ESC_V17){clearInterval(timer);init();}else if(++tries>150)clearInterval(timer);},100);});
 window.ESC_V18={renderMatrix,runGoals,runSensitivity};
})();



/* ===== Componente integrado: interfaz v19 ===== */
/* V19 · Vinculación explícita entre criterios territoriales, AHP y resultados.
 * No crea puntajes ficticios. El puntaje es exclusivamente el que calcula EscMulti.
 */
'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const fmt=(v,d=0)=>v===null||v===undefined||v===''?'No registrado':Number(v).toLocaleString('es-PE',{maximumFractionDigits:d});
 const risk=v=>{const t=String(v??'').trim().toUpperCase();return ['BAJO','MEDIO','ALTO','MUY ALTO'].includes(t)?t:'Sin dato';};
 const riskHTML=v=>{const t=risk(v);return `<span class="v19-risk v19-risk-${t.toLowerCase().replaceAll(' ','-')}">${esc(t==='Sin dato'?'Sin dato':t.charAt(0)+t.slice(1).toLowerCase())}</span>`;};
 let busy=false,ready=false,lastSignature='',rowLimit=90;
 function matrixRows(){if(!ready||!state?.all)return [];
  try{return typeof candidatesNow==='function'?candidatesNow():state.eligible||[];}catch(err){console.warn('V19 Matriz',err);return state.eligible||[];}}
 function renderPriority(force=false){if(!ready)return;
  const body=$('v19PriorityBody'),summary=$('v19PriorityCount');if(!body||!summary)return;
  const query=String($('v19PrioritySearch')?.value||'').trim().toLocaleLowerCase('es-PE');
  const rows=matrixRows();const shown=rows.filter(r=>!query||[r._cui,r._district,r._province,r._region,r._pliego].some(x=>String(x||'').toLocaleLowerCase('es-PE').includes(query)));
  const active=window.EscMulti?.activeProfile?.();
  const signature=[shown.length,rows.length,query,active?.name,shown.slice(0,20).map(r=>[r._cui,r._ahpScore].join(':')).join('|')].join(';');
  if(!force&&signature===lastSignature)return;lastSignature=signature;
  const ranked=shown.slice().sort((a,b)=>{
    const av=Number.isFinite(a._ahpScore)?a._ahpScore:-1,bv=Number.isFinite(b._ahpScore)?b._ahpScore:-1;
    return bv-av||String(a._cui).localeCompare(String(b._cui));
  });
  const profile=active?` · AHP: ${esc(active.name)}`:' · sin ponderación aplicada';
  summary.textContent=`${fmt(shown.length)} de ${fmt(rows.length)} candidatas${profile}`;
  body.innerHTML=ranked.slice(0,rowLimit).map(r=>{
    const flood=r['VIVIENDAS EN AREAS DE MAYOR SUSCEPTIBILIDAD INUNDACIONES'];
    const mass=r['VIVIENDAS EN AREAS DE MAYOR SUSCEPTIBILIDAD MOVIMIENTOS DE MASA'];
    const score=Number.isFinite(r._ahpScore)?`<strong class="v19-ahp-score">${fmt(r._ahpScore,3)}</strong>`:'<span class="v19-muted">Sin AHP</span>';
    return `<tr data-v19-cui="${esc(r._cui)}" title="Indicadores del distrito de intervención, no del puente"><td><b>${esc(r._cui)}</b><small>${esc(r._district)} · ${esc(r._province)}</small></td>
    <td><span class="v19-pcm ${r._fem==='SI'?'is-active':''}">${r._fem==='SI'?'Declarado':'No declarado'}</span></td>
    <td>${riskHTML(r['NIVEL DE RIESGO POR INUNDACIONES'])}</td><td>${riskHTML(r['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA'])}</td>
    <td><b>${fmt(r['RANKING POBREZA'])}</b><small>${esc(r['QUINTIL POBREZA']||'Sin quintil')}</small></td>
    <td>${fmt(r['AREA AGRICOLA'],1)}<small>ha · distrito</small></td>
    <td><b>${fmt(flood)} / ${fmt(mass)}</b><small>inundación / masa</small></td><td>${score}</td></tr>`;
  }).join('')||'<tr><td colspan="8">No hay inversiones con estos filtros.</td></tr>';
  const more=$('v19PriorityMore'), shownCount=$('v19PriorityShown');
  if(more)more.hidden=ranked.length<=rowLimit;
  if(shownCount)shownCount.textContent=`Mostrando ${fmt(Math.min(rowLimit,ranked.length))} de ${fmt(ranked.length)} inversiones`;
 }
 function budgetFeedback(note,type='ok'){
  const box=$('v19BudgetStatus');if(!box)return;box.className=`v19-budget-feedback is-${type}`;
  box.innerHTML=`<i class="bi ${type==='ok'?'bi-check-circle-fill':type==='pending'?'bi-hourglass-split':'bi-exclamation-circle'}"></i> ${esc(note)}`;
 }
 function budgetValue(){return state?.budget||0;}
 function checkBudget(){const budget=budgetValue();
  budgetFeedback(budget>0?`Presupuesto confirmado: S/ ${budget.toLocaleString('es-PE',{maximumFractionDigits:0})}. Ejecuta nuevamente MILP para actualizar la cartera.`:'Sin presupuesto definido: aún no puede optimizarse.');
  const status=$('v16SolverStatus');if(status&&budget>0&&!state?.v16Last)status.textContent='Presupuesto confirmado. El solucionador requiere ejecutar «Optimizar cartera».';
 }
 function schedule(){if(busy)return;busy=true;requestAnimationFrame(()=>{busy=false;renderPriority();});}
 function connect(){if(ready||!state?.all?.length||!window.ESC_V17)return false;ready=true;
  $('v19PrioritySearch')?.addEventListener('input',()=>{rowLimit=90;renderPriority(true);});
  $('v19PriorityMore')?.addEventListener('click',()=>{rowLimit+=90;renderPriority(true);});
  document.addEventListener('click',e=>{if(e.target.closest('[data-v17-go],[data-v17-next],[data-v17-prev],[data-v17-rule],[data-v18-criterion]'))setTimeout(()=>renderPriority(true),180);});
  document.addEventListener('change',e=>{if(e.target.closest('select,input'))setTimeout(()=>renderPriority(true),190);});
  const input=$('budgetInput');if(input){
   input.addEventListener('input',()=>budgetFeedback('Editando presupuesto… Pulsa Enter o sal del campo para confirmar.','pending'));
   input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();setTimeout(checkBudget,260);}});
   input.addEventListener('change',()=>setTimeout(checkBudget,290));input.addEventListener('blur',()=>setTimeout(checkBudget,290));
  }
  document.querySelectorAll('[data-budget-fraction]').forEach(btn=>btn.addEventListener('click',()=>setTimeout(checkBudget,160)));
  $('clearBudget')?.addEventListener('click',()=>setTimeout(checkBudget,100));
  const observed=$('v18CriteriaStatus');if(observed){const mo=new MutationObserver(schedule);mo.observe(observed,{childList:true,subtree:true,characterData:true});}
  renderPriority(true);checkBudget();return true;
 }
 window.addEventListener('DOMContentLoaded',()=>{let tries=0;const t=setInterval(()=>{if(connect()||++tries>150)clearInterval(t);},100);});
 window.ESC_V19={renderPriority};
})();
