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
  state.femLoaded = femEntries.length > 0 || records.some(r=>["SI","SÍ","NO"].includes(upper(r.en_emergencia_ds124_2026)));
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
      _lengthTotal: nval(first(raw, ['longitud','LONGITUD TOTAL','longitud_total','longitud_total_m'])),
      _regionNatural: naturalRegion(text(first(raw, ['region_natural','REGION NATURAL','region_geografica'])) || state.naturalRegionByUbigeo.get(districtCode)),
      _canonRaw: rowCanon(raw),
      _bridges: rowBridges(raw),
      _isReportedCanal: ESC_CANAL_CUIS.has(cui),
      _fem: upper(raw.en_emergencia_ds124_2026 || fem?.fem || '') === 'SI' ? 'SI' : upper(raw.en_emergencia_ds124_2026 || fem?.fem || '') === 'NO' ? 'NO' : 'SIN VERIFICAR',
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
  setVal('baseEligible', fmtInt(state.eligible.length));
  setVal('baseDeficit', fmtCompact(sum(state.eligible, '_deficit')));
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
function allConditions(r){return rowInScope(r)&&eligibleCondition(r)&&ioarrCondition(r)&&costRiskCondition(r);}
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
  const asc = state.rule !== 'pliego_max' && state.rule !== 'provincia_max';
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
    const ordered = items.slice().sort((a, b) => ((rule === 'pliego_max' || rule === 'provincia_max') ? b._deficit - a._deficit : a._deficit - b._deficit) || a._cui.localeCompare(b._cui));
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
  return candidates;
}
function prioritizedPortfolio(candidates, budget, goal = state.comparisonGoal, baseRule = state.rule, scope = state.recommendScope) {
  if (!(budget > 0)) return [];
  const remainingCanon = new Map();
  const seenPliegos = new Set(), seenProvinces = new Set(), chosen = new Set(), selected = [];
  let remaining = budget;
  const rows = recommendedCandidates(candidates, baseRule, scope).filter(r => r._deficit > 0);
  const limit = Math.min(rows.length, 2000);
  for (let iter = 0; iter < limit; iter++) {
    let best = null, bestScore = -Infinity, bestCost = 0, bestTier = -1;
    for (const r of rows) {
      if (chosen.has(r._cui)) continue;
      const canonLeft = state.canonAssist ? (remainingCanon.has(r._pliego) ? remainingCanon.get(r._pliego) : effectiveCanonBudget(r._pliego)) : 0;
      const cost = Math.max(0, r._deficit - canonLeft);
      if (cost > remaining + 1e-6) continue;
      const tier = goal === 'pliegos' ? (seenPliegos.has(r._pliego) ? 0 : 1)
        : goal === 'provincias' ? (seenProvinces.has(r._provinceCode) ? 0 : 1)
        : goal === 'emergencia' ? (r._fem === 'SI' ? 1 : 0) : 1;
      let gain = 1;
      if (goal === 'pliegos') gain = (seenPliegos.has(r._pliego) ? 0.02 : 1);
      else if (goal === 'provincias') gain = (seenProvinces.has(r._provinceCode) ? 0.02 : 1);
      else if (goal === 'puentes') gain = Math.max(0, r._bridges) + 0.03;
      else if (goal === 'emergencia') gain = (r._fem === 'SI' ? 1 : 0.02);
      // Desempate estable; favorece uso responsable del presupuesto y evita
      // que un coste cero bloquee inversiones posteriores.
      const score = gain / Math.max(10000, cost) + gain * 1e-13;
      if (tier > bestTier || (tier === bestTier && (score > bestScore + 1e-18 || (Math.abs(score - bestScore) < 1e-18 && cost < bestCost)))) {
        best = r; bestScore = score; bestCost = cost;bestTier=tier;
      }
    }
    if (!best) break;
    const canonLeft = state.canonAssist ? (remainingCanon.has(best._pliego) ? remainingCanon.get(best._pliego) : effectiveCanonBudget(best._pliego)) : 0;
    const allocated = Math.min(best._deficit, canonLeft);
    const net = Math.max(0, best._deficit - allocated);
    if (net > remaining + 1e-6) break;
    remainingCanon.set(best._pliego, Math.max(0, canonLeft - allocated));
    remaining = Math.max(0, remaining - net);
    chosen.add(best._cui);seenPliegos.add(best._pliego);seenProvinces.add(best._provinceCode);
    selected.push({ ...best, _canonApplied:allocated, _deficitNet:net });
  }
  return selected.sort((a,b)=>b._deficitNet-a._deficitNet || a._cui.localeCompare(b._cui));
}

function selectScenario(candidates, rule = state.rule, budget = state.budget) {
  if (rule === 'priorizada') return state.recommendation ? state.recommendation.rows : [];
  let rows = candidates.slice();
  if (rule === 'pliego_min' || rule === 'pliego_max') rows = chooseOne(rows, r => r._pliego, rule === 'pliego_max');
  if (rule === 'provincia_min' || rule === 'provincia_max') rows = chooseOne(rows, r => r._provinceCode || `${r._region}|${upper(r._province)}`, rule === 'provincia_max');

  if (budget > 0) {
    const preAllocated = applyCanonAllocation(rows, rule);
    const ordered = preAllocated.slice().sort((a, b) => {
      const difference = state.budgetOrder === 'desc' ? b._deficitNet - a._deficitNet : a._deficitNet - b._deficitNet;
      return difference || a._cui.localeCompare(b._cui);
    });
    let remaining = budget;
    const canonRemaining = new Map();
    const selectedRows = [];
    for (const row of ordered) {
      const pool = canonRemaining.has(row._pliego) ? canonRemaining.get(row._pliego) : effectiveCanonBudget(row._pliego);
      const applied = Math.min(row._deficit, pool);
      const net = Math.max(0, row._deficit - applied);
      if (net <= remaining + 1e-6) {
        // Conservamos el descuento exacto utilizado AL DECIDIR la inclusión.
        // No recalculamos el canon sobre un subconjunto en distinto orden.
        selectedRows.push({...row, _canonApplied: applied, _deficitNet: net});
        remaining -= net;
        canonRemaining.set(row._pliego, Math.max(0, pool - applied));
      }
    }
    return selectedRows.sort((a, b) => b._deficitNet - a._deficitNet || b._deficit - a._deficit || a._cui.localeCompare(b._cui));
  }
  return applyCanonAllocation(rows, rule).sort((a, b) => b._deficitNet - a._deficitNet || b._deficit - a._deficit || a._cui.localeCompare(b._cui));
}

function eligibleCondition(row) {
  return (!state.fem || row._fem === 'SI') && matchCanonCoverage(row);
}
function rowInScope(row) {
  if (state.scopeDistrict) return row._districtCode === state.scopeDistrict;
  if (state.scopeProvince) return row._provinceCode === state.scopeProvince;
  if (state.scopeRegion) return row._regionCode === state.scopeRegion;
  return true;
}

function simulate() {
  const candidates = candidatesNow();
  state.scenario = state.activeView === 'recommended' && state.recommendation ? state.recommendation.rows : selectScenario(candidates);
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


const ESC_ALTERNATIVE_RULES = [
  ['priorizada', 'Cartera recomendada por objetivo'],
  ['todos', 'Todas las IOARR elegibles'],
  ['pliego_min', 'Una por pliego · menor déficit'],
  ['pliego_max', 'Una por pliego · mayor déficit'],
  ['provincia_min', 'Una por provincia · menor déficit'],
  ['provincia_max', 'Una por provincia · mayor déficit']
];
function comparisonStats(rows, rule) {
  const spent=sum(rows,'_deficitNet');
  return {rule,rows,n:rows.length,pliegos:uniq(rows,'_pliego'),provincias:uniq(rows,'_provinceCode'),
    bridges:sum(rows,'_bridges'),cost:sum(rows,'_cost'),emergencies:rows.filter(r=>r._fem==='SI').length,spent,
    budgetRemaining:state.budget>0?Math.max(0,state.budget-spent):null};
}
function goalScore(stats,goal) {
  return ({ioarr:stats.n,pliegos:stats.pliegos,provincias:stats.provincias,puentes:stats.bridges,emergencia:stats.emergencies})[goal]||0;
}
function renderComparison() {
  if (!$('comparisonBody')) return;
  const candidates=candidatesNow();
  const ready=state.budget>0;
  const results=ESC_ALTERNATIVE_RULES.map(([rule,label])=>({
    ...comparisonStats(rule==='priorizada'?(state.recommendation?.rows||[]):selectScenario(candidates,rule,state.budget),rule),label
  }));
  state.comparisonResults=results;
  const current=state.activeView==='recommended' && state.recommendation ? results[0] : results.find(r=>r.rule===state.rule)||results[1];
  const comparable=results.filter(r=>r.rule!=='priorizada'||!!state.recommendation);
  const best=ready?comparable.slice().sort((a,b)=>goalScore(b,state.comparisonGoal)-goalScore(a,state.comparisonGoal)||a.spent-b.spent)[0]:null;
  setVal('compareBudgetBadge',ready?`Techo: ${fmtCompact(state.budget)}`:'Sin presupuesto fijado');
  setVal('compareMethod',state.recommendation?`Propuesta generada para «${state.recommendation.goalLabel}». No modifica la cartera de origen. Para analizarla, selecciónala en la matriz.`:'Las alternativas comparten el mismo presupuesto y filtros. El objetivo no crea una recomendación hasta pulsar «Generar recomendación».');
  const spent=sum(state.scenario,'_deficitNet');
  const gross=sum(state.scenario,'_deficit');
  const canonUsed=sum(state.scenario,'_canonApplied');
  const remains=ready?Math.max(0,state.budget-spent):null;
  $('decisionBudget').innerHTML=ready?`<div><span>Techo de recursos adicionales</span><strong>${fmtCompact(state.budget)}</strong></div><div><span>Déficit bruto seleccionado</span><strong>${fmtCompact(gross)}</strong></div><div><span>Canon considerado</span><strong class="esc-canon-positive">${fmtCompact(canonUsed)}</strong></div><div><span>Financiamiento adicional asignado</span><strong>${fmtCompact(spent)}</strong></div><div><span>Saldo del techo</span><strong>${fmtCompact(remains)}</strong></div><div class="esc-budget-progress"><span style="width:${Math.min(100,spent/state.budget*100)}%"></span></div><small class="esc-budget-equation">Déficit bruto seleccionado = Canon considerado + Financiamiento adicional asignado. El techo solo limita este último.</small>`:'<div class="esc-budget-await">Sin presupuesto fijado: se muestran todas las inversiones que cumplen la regla.</div>';
  $('portfolioModeBar').innerHTML=state.activeView==='recommended'&&state.recommendation?`<b>En análisis: cartera recomendada</b> para ${esc(state.recommendation.goalLabel)}. <button type="button" id="returnManualPortfolio">Volver a la cartera configurada</button>`:`<b>En análisis:</b> ${esc(ESC_ALTERNATIVE_RULES.find(r=>r[0]===state.rule)?.[1]||'Regla configurada')} · Orden ${state.budgetOrder==='asc'?'menor':'mayor'} brecha primero.`;
  const back=$('returnManualPortfolio');if(back)back.addEventListener('click',()=>{state.activeView='manual';simulate();});
  const rec=state.recommendation;
  $('recommendationPanel').innerHTML=rec?`<div class="esc-recommendation-heading"><span class="esc-rec-mark"><i class="bi bi-lightbulb"></i></span><div><small>PROPUESTA GENERADA · ${esc(rec.scopeLabel)}</small><strong>${fmtInt(results[0].n)} IOARR · ${fmtInt(results[0].pliegos)} pliegos · ${fmtInt(results[0].provincias)} provincias</strong><p>${fmtInt(results[0].bridges)} puentes · ${fmtCompact(results[0].spent)} de financiamiento · ${fmtCompact(results[0].budgetRemaining)} sin asignar</p></div></div><button class="esc-rec-apply" type="button" id="applyRecommended">${state.activeView==='recommended'?'En análisis':'Analizar esta cartera'} <i class="bi bi-arrow-right"></i></button>`:'<div class="esc-budget-await">Selecciona objetivo y base; pulsa «Generar recomendación». Tus filtros actuales no cambiarán.</div>';
  const apply=$('applyRecommended');if(apply)apply.addEventListener('click',()=>{state.activeView='recommended';simulate();});
  $('comparisonBody').innerHTML=comparable.map(r=>{
    const active=(state.activeView==='recommended'&&r.rule==='priorizada')||(state.activeView==='manual'&&r.rule===state.rule);
    return `<tr class="${active?'is-selected':''} ${r.rule===best?.rule?'is-best':''} ${r.rule==='priorizada'?'is-recommended':''}"><td><span class="esc-alt-name">${esc(r.label)}</span>${r.rule===best?.rule?'<small>Mayor resultado para el objetivo</small>':''}</td><td>${fmtInt(r.n)}</td><td>${fmtInt(r.pliegos)}</td><td>${fmtInt(r.provincias)}</td><td>${fmtInt(r.bridges)}</td><td>${fmtInt(r.emergencies)}</td><td><b>${fmtCompact(r.spent)}</b>${state.canonAssist?`<small>Canon: ${fmtCompact(sum(r.rows,'_canonApplied'))} · Bruto: ${fmtCompact(sum(r.rows,'_deficit'))}</small>`:''}</td><td>${r.n?fmtCompact(r.spent/r.n):'—'}</td><td>${r.bridges?fmtCompact(r.spent/r.bridges):'—'}</td><td>${r.budgetRemaining===null?'—':fmtCompact(r.budgetRemaining)}</td><td><button class="esc-alt-apply" type="button" data-rule="${r.rule}">${active?'En análisis':'Analizar'}</button></td></tr>`;
  }).join('');
  if(!ready){setVal('comparisonInterpretation','Sin presupuesto fijado, la restricción por pliego o provincia puede reducir el número atendido.');$('opportunitySummary').innerHTML='';$('opportunityDetails').innerHTML='';$('sensitivityGraph').innerHTML='';setVal('sensitivityHint','');return;}
  const currentScore=goalScore(current,state.comparisonGoal),bestScore=goalScore(best,state.comparisonGoal);
  const underuse=current.budgetRemaining>state.budget*.2;
  setVal('comparisonInterpretation',`La cartera analizada cubre ${fmtCompact(gross)} de déficit: ${fmtCompact(canonUsed)} con canon considerado y ${fmtCompact(spent)} con presupuesto adicional. Consume ${Math.round(current.spent/state.budget*100)} % del techo. ${underuse?'El saldo puede responder a las restricciones o a que las siguientes inversiones no caben en el saldo.':'La selección está condicionada por el objetivo y el monto disponible.'} Promedio: ${current.n?fmtCompact(current.spent/current.n):'—'} por inversión.`);
  const activeIds=new Set(current.rows.map(r=>r._cui));const betterIds=new Set(best.rows.map(r=>r._cui));
  const additions=best.rows.filter(r=>!activeIds.has(r._cui)); const removed=current.rows.filter(r=>!betterIds.has(r._cui));
  const noun=state.comparisonGoal==='puentes'?'puentes':state.comparisonGoal==='provincias'?'provincias':state.comparisonGoal==='pliegos'?'pliegos':'inversiones';
  $('opportunitySummary').innerHTML=`<div><small>Mayor resultado comparado</small><strong>${esc(best.label)}</strong></div><div><small>Resultado actual</small><strong>${fmtInt(currentScore)} ${noun}</strong></div><div><small>Oportunidad no aprovechada</small><strong>${fmtInt(Math.max(0,bestScore-currentScore))} ${noun}</strong></div>`;
  $('opportunityDetails').innerHTML=`<div class="esc-tradeoff"><div><small>Inversiones adicionales de la alternativa con mayor resultado</small><strong>${fmtInt(additions.length)}</strong><p>${additions.slice(0,3).map(r=>esc(r._cui)).join(' · ')||'Sin diferencias de CUI.'}</p></div><div><small>Inversiones de la cartera activa que saldrían</small><strong>${fmtInt(removed.length)}</strong><p>Diferencia: ${best.pliegos-current.pliegos} pliegos · ${best.provincias-current.provincias} provincias · ${best.bridges-current.bridges} puentes.</p></div></div>`;
  // Tres casos directamente comparables: menos, igual y más recursos. La propuesta
  // se recalcula con el objetivo y la base congelados al generarla.
  const levels=[.75,1,1.25];
  const variation=levels.map(factor=>{
    const b=Math.round(state.budget*factor);
    const rows=state.activeView==='recommended'&&rec?prioritizedPortfolio(candidates,b,rec.goal,rec.baseRule,rec.scope):selectScenario(candidates,state.rule,b);
    return {factor,budget:b,...comparisonStats(rows,state.rule)};
  });
  const max=Math.max(1,...variation.map(p=>goalScore(p,state.comparisonGoal)));
  $('sensitivityGraph').innerHTML=variation.map(p=>`<div class="esc-sensitivity-item"><strong>${Math.round(p.factor*100)} % · ${fmtCompact(p.budget)}</strong><div class="esc-sensitivity-track"><span style="width:${Math.max(0,goalScore(p,state.comparisonGoal)/max*100)}%"></span></div><small>${fmtInt(goalScore(p,state.comparisonGoal))} ${esc(noun)} · usa ${fmtCompact(p.spent)}</small></div>`).join('');
  setVal('sensitivityHint',`Tres escenarios de presupuesto: 25 % menos, actual y 25 % más. ${variation[2]&&goalScore(variation[2],state.comparisonGoal)===goalScore(variation[1],state.comparisonGoal)?'El aumento no mejora el resultado bajo las restricciones actuales.':''}`);
}

function generateRecommendation() {
  if (!(state.budget>0)) { $('budgetInput').focus();return; }
  const candidates=candidatesNow();
  const goal=state.comparisonGoal,baseRule=state.rule,scope=state.recommendScope;
  const rows=prioritizedPortfolio(candidates,state.budget,goal,baseRule,scope);
  state.recommendation={rows,goal,baseRule,scope,scopeLabel:scope==='current'?`Basada en ${ESC_ALTERNATIVE_RULES.find(x=>x[0]===baseRule)?.[1]||baseRule}`:'Todas las IOARR filtradas',goalLabel:$('comparisonGoal').selectedOptions[0].text};
  state.activeView='manual';
  renderAll();
}

function invalidateRecommendation() {
  if(state.recommendation){state.recommendation=null;state.activeView='manual';}
}

function buildAuditRows() {
  const selected=new Set(state.scenario.map(r=>r._cui));
  const all=state.all;
  // Solo para identificar las candidatas descartadas por una regla de pliego/provincia.
  const filtered=candidatesNow();
  const rule=state.activeView==='recommended'?(state.recommendation?.scope==='current'?state.recommendation.baseRule:'todos'):state.rule;
  const allowed=rule==='pliego_min'||rule==='pliego_max'?chooseOne(filtered,r=>r._pliego,rule==='pliego_max'):
    rule==='provincia_min'||rule==='provincia_max'?chooseOne(filtered,r=>r._provinceCode,rule==='provincia_max'):filtered;
  const allowedIds=new Set(allowed.map(r=>r._cui));
  state.auditRows=all.filter(r=>!selected.has(r._cui)).map(r=>{
    let reason='No seleccionada bajo la configuración vigente';
    if(!(r._deficit>0))reason='Fuera de la cartera con déficit: sin brecha financiera positiva';
    else if(!rowInScope(r))reason='Fuera del ámbito geográfico seleccionado';
    else if(state.fem&&r._fem!=='SI')reason=r._fem==='NO'?'Distrito no incluido en la declaratoria El Niño':'Distrito sin verificación en la declaratoria El Niño';
    else if(!ioarrCondition(r))reason='Registro identificado como canal, excluido del análisis de inversiones de puente';
    else if(!costRiskCondition(r))reason=`Excluida por decisión explícita: costo por metro ≥ ${state.costAlertFactor.toFixed(2)} veces la referencia de pares similares en ${r._regionNatural.toLowerCase()}`;
    else if(state.coverageEnabled&&!matchCanonCoverage(r))reason=`Canon del pliego cubre más de ${state.coverageMax} % del déficit`;
    else if(!allowedIds.has(r._cui)){
      const insufficient=rule.includes('pliego')?!r._pliego:(!r._provinceCode&&!r._province);
      reason=insufficient?'Sin datos territoriales o de pliego suficientes para aplicar la regla':rule.includes('pliego')?'Otra IOARR del mismo pliego cumple mejor la regla':'Otra IOARR de la provincia cumple mejor la regla';
    }
    else if(state.budget>0){
      const pool=state.canonAssist?effectiveCanonBudget(r._pliego):0;
      const minNeed=Math.max(0,r._deficit-pool);
      if(minNeed>state.budget)reason='Su brecha excede por sí sola el presupuesto global';
      else if(state.activeView==='recommended')reason='No fue incorporada por la evaluación de beneficio por sol o por falta de saldo';
      else reason=`No cabe en el saldo según orden ${state.budgetOrder==='asc'?'menor':'mayor'} brecha primero`;
    } else if(rule!=='todos')reason='No seleccionada por regla de distribución';
    return {...r,_auditReason:reason};
  });
  return state.auditRows;
}
function renderAudit() {
  const rows=buildAuditRows();
  setVal('auditCounter',`${fmtInt(rows.length)} no seleccionadas`);
  $('auditBody').innerHTML=rows.slice(0,180).map(r=>`<tr><td>${esc(r._cui)}</td><td><b>${esc(r._pliegoDisplay)}</b><small>${esc(r._province)} · ${esc(r._region)}</small></td><td>${fmtCompact(r._deficit)}</td><td>${esc(r._auditReason)}</td></tr>`).join('')||'<tr><td colspan="4">Todas las IOARR de la cartera con déficit están seleccionadas.</td></tr>';
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
  state.scopeRegion = '';
  state.scopeProvince = '';
  state.scopeDistrict = '';
  if (mode === 'region') state.scopeRegion = prevRegion === key ? '' : key;
  if (mode === 'province') state.scopeProvince = prevProvince === key ? '' : key;
  if (mode === 'district') state.scopeDistrict = prevDistrict === key ? '' : key;
  if (rerun) { invalidateRecommendation();simulate(); focusMapToScope(); }
}

function clearScopes() {
  state.scopeRegion = ''; state.scopeProvince = ''; state.scopeDistrict = '';
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
  btn.innerHTML = '<i class="bi bi-unlock"></i> Sin límite financiero';
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
    formatMoneyLive(e.target);
    clearTimeout(budgetDebounce);
    budgetDebounce=setTimeout(()=>{state.budget=parseMoneyInput(e.target.value);refreshBudgetUi();change();},220);
  });
  $('budgetInput').addEventListener('change',e=>{clearTimeout(budgetDebounce);formatMoneyInput(e.target);state.budget=parseMoneyInput(e.target.value);setVal('budgetLiveReadout',state.budget?`Monto ingresado: ${fmtFull(state.budget)}`:'Ingresa un monto global en soles.');refreshBudgetUi();change();});
  $('clearBudget').addEventListener('click',()=>{$('budgetInput').value='';state.budget=0;setVal('budgetLiveReadout','Sin límite financiero.');refreshBudgetUi();change();});
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
  $('clearScope').addEventListener('click',()=>{clearScopes();change();focusMapToScope();});
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
    todos: 'Todas las IOARR elegibles',
    pliego_min: 'Una inversión por pliego: menor déficit',
    pliego_max: 'Una inversión por pliego: mayor déficit',
    provincia_min: 'Una inversión por provincia: menor déficit',
    provincia_max: 'Una inversión por provincia: mayor déficit'
  };
  return [
    ['Cartera analizada',state.activeView==='recommended'?'Recomendación generada':names[state.rule] || state.rule],
    ['Orden por presupuesto',state.budgetOrder==='asc'?'Menor brecha primero':'Mayor brecha primero'],
    ['Objetivo de asignación', $('comparisonGoal').selectedOptions[0].text],
    ['Base de recomendación',state.recommendation?.scopeLabel||'No generada'],
    ['Registros de canal identificados',state.ioarrCondition==='exclude'?'Excluir CUI 2677338, 2675020 y 2658249':'Incluir todos'],
    ['Canon aplicable estimado',`${state.canonUsePercent} % del canon registrado (si se activa)`],
    ['Control de costos',state.costExclusionMode==='none'?'Solo revisión, sin exclusión':`Excluir alertas ≥ ${state.costAlertFactor} veces el costo/m de pares similares`],
    ['Zona El Niño (D. S. N.° 124-2026-PCM)', state.fem ? 'Solo distritos declarados' : 'Sin restricción'],
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
  const columns = ['CUI', 'Región', 'Provincia', 'Distrito', 'Pliego', 'Puentes', 'Déficit (S/)', 'Canon considerado (S/)', 'Brecha pendiente (S/)', 'Costo actualizado (S/)', 'Cobertura canon (%)', 'El Niño', 'Nombre de inversión', 'Canon del pliego (S/)', 'UBIGEO', 'Ítem anexo PCM'];
  const query = upper(state.search);
  const visibleRows = state.scenario.filter(r => !query || r._cui.includes(query) || r._pliego.includes(query) || upper(r._district).includes(query) || upper(r._province).includes(query) || upper(r._region).includes(query));
  const records = visibleRows.map(r => [r._cui, r._region, r._province, r._district, r._pliegoDisplay, r._bridges, r._deficit, r._canonApplied, r._deficitNet, r._cost, canonCoverage(r), r._fem, r.denominacion_inversion || '', canonAmountForPliego(r._pliego),r._districtCode,r._femNum]);
  const auditRows=buildAuditRows();
  const auditColumns=['CUI','Pliego','Región','Provincia','Distrito','Déficit original (S/)','Motivo de exclusión'];
  const auditRecords=auditRows.map(r=>[r._cui,r._pliegoDisplay,r._region,r._province,r._district,r._deficit,r._auditReason]);
  const file = `alternativas_atencion_ley32416_${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    window.ESCExcel.download({ filename: file, title: 'Ley N.° 32416 - Evaluación de alternativas de atención', criteria: scenarioCriteria(), columns, records, comparisons: state.comparisonResults, moneyColumns: [6,7,8,9,13], integerColumns: [5],auditColumns,auditRecords });
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
    g.append(circle,number,title);g.addEventListener('click',ev=>{ev.stopPropagation();applyScope('region',item.key,true);});frag.appendChild(g);
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

    simulate();
    await activateMapView('region');
  } catch (err) {
    console.error('Escenarios:', err);
    setVal('mapSubtitle', 'Error de carga');
    $('mapLoading').textContent = `No se pudieron leer los datos: ${err.message}. Revisa data/puentes.json y el servidor local.`;
  }
}
window.addEventListener('DOMContentLoaded', load);
