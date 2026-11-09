/* Escenarios · lectura de decisiones, sensibilidad multicriterio y reporte de cartera.
 * No cambia el motor MILP ni las fuentes territoriales. */
(()=>{'use strict';
 const $=id=>document.getElementById(id), fmt=n=>Number(n||0).toLocaleString('es-PE',{maximumFractionDigits:0}),
 money=n=>`S/ ${(Number(n)||0).toLocaleString('es-PE',{maximumFractionDigits:2})}`,
 mini=n=>`S/ ${(Number(n||0)/1e6).toLocaleString('es-PE',{maximumFractionDigits:2})} M`,
 esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const factors={poverty:{title:'Pobreza distrital',icon:'bi-people',field:'QUINTIL POBREZA',detail:'Quintiles 1 y 2'},agriculture:{title:'Superficie agrícola',icon:'bi-flower1',field:'AREA AGRICOLA',detail:'Hectáreas distritales'},flood:{title:'Inundaciones',icon:'bi-water',field:'NIVEL DE RIESGO POR INUNDACIONES',detail:'Clasificación CENEPRED'},mass:{title:'Movimientos en masa',icon:'bi-layers-half',field:'NIVEL DE RIESGO POR MOVIMIENTOS DE MASA',detail:'Clasificación CENEPRED'}};
 let prior=null,priorSignature='',lastBase=null,compareHistory=[],busy=false,lastRender='',lastStep=0;
 const val=x=>Number(x)||0, high=x=>['ALTO','MUY ALTO'].includes(String(x||'').toUpperCase().trim()),
 q=x=>({'PRIMER QUINTIL':1,'SEGUNDO QUINTIL':2,'TERCER QUINTIL':3,'CUARTO QUINTIL':4,'QUINTO QUINTIL':5})[String(x||'').toUpperCase()]||Number(x)||0;
 function stats(rows){rows=Array.isArray(rows)?rows:[];return {n:rows.length,bridges:rows.reduce((a,r)=>a+val(r._bridges),0),gross:rows.reduce((a,r)=>a+val(r._deficit),0),net:rows.reduce((a,r)=>a+val(r._deficitNet??r._deficit),0),regions:new Set(rows.map(r=>r._regionCode).filter(Boolean)).size,provinces:new Set(rows.map(r=>r._provinceCode).filter(Boolean)).size,districts:new Set(rows.map(r=>r._districtCode).filter(Boolean)).size,ids:new Set(rows.map(r=>r._cui)),rows};}
 function renderKpis(){if(!state.all.length)return;
  const step=Number(document.querySelector('.v17-stepper .is-active')?.dataset.v17Go||1);
  const baseToggle=$('escBaseToggle');if(baseToggle&&step!==lastStep){baseToggle.open=step===1;lastStep=step;}
  const optimized=!!(state.activeView==='recommended'&&state.recommendation?.rows?.length&&state.v16Last?.budget===state.budget);
  const selected=optimized?state.recommendation.rows:(state.scenario||[]);
  const current=stats(selected),eligible=stats(candidatesNow()),signature=[state.activeView,state.rule,current.n,current.bridges,current.gross,current.net,eligible.n,state.scopeRegion,state.scopeProvince,state.scopeDistrict,state.v16Last?.rows?.length||0].join('|'),key=[step,signature].join('|');
  if(key===lastRender)return;
  if(priorSignature&&signature!==priorSignature&&prior)lastBase=prior;
  const before=lastBase;
  const previousText=before?'Selección anterior':'Referencia inicial';
  $('escLiveCompared').textContent=before?'Δ respecto de la selección anterior':'Sin cambios anteriores registrados';
  $('escLiveTitle').textContent=optimized?'Cartera optimizada':step===1?'Cartera candidata':'Preselección sin financiar';
  const metrics=[['IOARR',current.n,'n',fmt],['Puentes',current.bridges,'bridges',fmt],['Déficit bruto',current.gross,'gross',mini],['Financiamiento requerido',current.net,'net',mini]];
  $('escLiveGrid').innerHTML=metrics.map(([label,x,key0,format])=>{const diff=before?x-before[key0]:null;return `<div class="esc-live-card"><span>${label}</span><strong>${format(x)}</strong><small class="${diff===null?'':diff>0?'esc-delta-rise':diff<0?'esc-delta-fall':'esc-delta-zero'}">${diff===null?'— Sin comparación':`${diff>0?'+':''}${format(diff)} · ${previousText}`}</small></div>`;}).join('');
  $('escLiveFoot').textContent=`${fmt(current.provinces)} provincias · ${fmt(current.districts)} distritos · ${fmt(eligible.n)} candidatas elegibles. ${optimized?'Financiamiento calculado con la solución activa.':'Valores referenciales, antes de asignar canon y presupuesto en la optimización.'}`;
  prior=current;priorSignature=signature;lastRender=key;
 }
 function factorCoverage(rows,key){const f=factors[key];return rows.filter(r=>{const v=r[f.field];return v!==null&&v!==undefined&&String(v).trim()!==''&&String(v).toUpperCase()!=='NO DETERMINADO';}).length;}
 function factorStats(rows,key){if(key==='poverty')return `${fmt([...new Set(rows.filter(r=>q(r[factors[key].field])<=2&&q(r[factors[key].field])>0).map(r=>r._districtCode))].length)} distritos en quintiles 1–2`;
 if(key==='agriculture')return `${fmt([...new Map(rows.filter(r=>Number.isFinite(Number(r['AREA AGRICOLA']))).map(r=>[r._districtCode,r])).values()].reduce((s,r)=>s+val(r['AREA AGRICOLA']),0))} ha distritales*`;
 return `${fmt([...new Set(rows.filter(r=>high(r[factors[key].field])).map(r=>r._districtCode))].length)} distritos con nivel alto o muy alto`;}
 function renderFactors(){const host=$('escFactorCards');if(!host||!state.all.length)return;
   const rows=candidatesNow(),p=window.EscMulti?.activeProfile?.();let coverage=0;
   host.innerHTML=Object.entries(factors).map(([k,f])=>{const i=p?.keys?.indexOf(k)??-1,weight=i>=0?p.weights[i]:null,available=factorCoverage(rows,k);coverage+=available;
    return `<article class="esc-factor-card"><div class="esc-factor-card-head"><span class="esc-factor-icon"><i class="bi ${f.icon}"></i></span><span class="esc-factor-weight">${weight===null?'Sin peso aplicado':`${(weight*100).toFixed(1)} %`}</span></div><h4>${f.title}</h4><p>${factorStats(rows,k)}</p><div class="esc-factor-meter"><span style="width:${rows.length?available/rows.length*100:0}%"></span></div><small>${fmt(available)} / ${fmt(rows.length)} IOARR con información · ${f.detail}</small></article>`;}).join('');
   $('escFactorModel').textContent=p?`AHP activo: ${p.name} · RC ${((p.cr||0)*100).toFixed(1)} %`:'AHP no aplicado · Configura los criterios para obtener una prioridad ponderada';
   $('escFactorCoverage').textContent='*La superficie y los atributos territoriales son distritales; no se suman por inversión para estimar beneficiarios.';
 }
 function activeScenes(){return window.ESC_V17?.scenes?.()||[];}
 function sceneById(id){return activeScenes().find(s=>s.id===id);}
 function sceneRows(scene){const map=new Map(state.all.map(r=>[r._cui,r]));return (scene?.rows||[]).map(r=>{const raw=map.get(r.cui);return raw?{...raw,_canonApplied:val(r.canon),_deficitNet:val(r.net),_ahpScore:r.ahpScore}:null;}).filter(Boolean);}
 function currentScene(){const a=activeScenes(),pick=state.v16Last?.rows?.map(r=>r._cui).join('|');return a.find(s=>s.rows.map(r=>r.cui).join('|')===pick)||a[0]||null;}
 function renderFinal(){const host=$('escFinalHighlights');if(!host)return;const scene=currentScene();if(!scene){host.textContent='Optimiza y guarda una alternativa para obtener el resultado final.';return;}
  const current=stats(sceneRows(scene)),candidate=stats(candidatesNow());
  host.innerHTML=`<div><span>Escenario</span><strong>${esc(scene.name)}</strong></div><div><span>Inversiones seleccionadas</span><strong>${fmt(current.n)} / ${fmt(candidate.n)}</strong></div><div><span>Puentes</span><strong>${fmt(current.bridges)}</strong></div><div><span>Financiamiento adicional</span><strong>${mini(current.net)}</strong></div><div><span>Canon aplicado</span><strong>${mini(scene.rows.reduce((s,r)=>s+val(r.canon),0))}</strong></div>`;
 }
 function sensitivityRows(a,b){const sa=stats(sceneRows(a)),sb=stats(sceneRows(b));const entered=[...sb.ids].filter(x=>!sa.ids.has(x)),exited=[...sa.ids].filter(x=>!sb.ids.has(x));return {sa,sb,entered,exited};}
 async function runSensitivity(){if(busy)return;const status=$('escSensitivityStatus'),profile=window.EscMulti?.activeProfile?.(),goal=$('comparisonGoal');
  if(!profile||profile.keys.length<2){status.textContent='Primero aplica un modelo AHP consistente con al menos dos criterios.';return;}
  if((profile.cr||0)>.10){status.textContent='Corrige la consistencia AHP (RC ≤ 10 %) antes de realizar la sensibilidad.';return;}
  const key=$('escSensitivityFactor').value,factor=Number($('escSensitivityChange').value),idx=profile.keys.indexOf(key);
  if(idx<0){status.textContent='El factor elegido no está activo en el AHP. Actívalo desde «Ajustar importancia AHP».';return;}
  if(!state.budget||!state.v16Last?.rows?.length){status.textContent='Define presupuesto y optimiza primero una cartera base.';return;}
  if(goal.value!=='ahp'){status.textContent='La sensibilidad de pesos requiere «Mayor prioridad multicriterio (AHP)» como objetivo. Selecciónalo y optimiza una cartera base antes de continuar.';return;}
  const baseline=currentScene();if(!baseline){status.textContent='La cartera base debe estar guardada antes de ejecutar la sensibilidad.';return;}
  if(baseline.criterion!=='ahp'&&baseline.config?.goal!=='ahp'){status.textContent='El escenario base fue resuelto con un objetivo distinto de AHP. Optimiza y guarda una cartera con objetivo AHP para comparar sus pesos.';return;}
  const w=[...profile.weights];w[idx]*=factor;const sum=w.reduce((a,b)=>a+b,0),adjusted=w.map(x=>x/sum);
  busy=true;$('escSensitivityRun').disabled=true;status.textContent=`Resolviendo nueva cartera: ${factors[key].title}, peso ${(profile.weights[idx]*100).toFixed(1)} % → ${(adjusted[idx]*100).toFixed(1)} %…`;
  try{
    if(!window.EscMulti.applySensitivityWeights(adjusted))throw Error('No se pudo configurar la variación de pesos.');
    // generateRecommendation guarda automáticamente la solución mediante el orquestador existente.
    await generateRecommendation();
    const changed=currentScene();if(!changed||changed.id===baseline.id)throw Error('El optimizador no produjo una nueva cartera guardada.');
    // El resultado matemático queda inmutable en el escenario guardado; los pesos base se restauran para nuevas pruebas.
    const data=sensitivityRows(baseline,changed);
    const record={name:factors[key].title,rate:factor,baseline:baseline.id,result:changed.id,baseWeight:profile.weights[idx],newWeight:adjusted[idx],entered:data.entered,exited:data.exited};
    compareHistory.unshift(record);
    $('escSensitivityResults').innerHTML=compareHistory.map(r=>{const A=sceneById(r.baseline),B=sceneById(r.result);if(!A||!B)return '';const d=sensitivityRows(A,B);
      return `<article class="esc-sens-row"><header><strong>${esc(r.name)} · ${r.rate>1?'+':''}${((r.rate-1)*100).toFixed(0)} %</strong><span>${esc(A.name)} → ${esc(B.name)}</span></header><div><span>IOARR <b>${fmt(d.sa.n)} → ${fmt(d.sb.n)}</b></span><span>Puentes <b>${fmt(d.sa.bridges)} → ${fmt(d.sb.bridges)}</b></span><span>Financiamiento <b>${mini(d.sa.net)} → ${mini(d.sb.net)}</b></span><span>Ingresan <b>${fmt(d.entered.length)}</b></span><span>Salen <b>${fmt(d.exited.length)}</b></span></div><small>Pesos ${ (r.baseWeight*100).toFixed(1)} % → ${(r.newWeight*100).toFixed(1)} % · ${d.entered.length+d.exited.length?'La composición cambió':'Se mantuvieron los mismos CUI'}.</small></article>`;}).join('');
    status.textContent=`Escenario guardado: ${changed.name}. ${fmt(data.entered.length)} CUI ingresan y ${fmt(data.exited.length)} salen respecto a ${baseline.name}. Puedes comparar ambas carteras en el bloque siguiente.`;
    window.ESC_V17?.compare?.(baseline.id,changed.id);
  }catch(error){status.textContent=`No se acreditó una nueva solución: ${error.message}`;}
  finally{window.EscMulti?.restoreActiveWeights?.(profile);busy=false;$('escSensitivityRun').disabled=false;renderFactors();renderFinal();}
 }
 function hSafe(x){return esc(x);}
 function downloadReport(){const scene=currentScene();if(!scene){window.alert('Optimiza una cartera antes de descargar sus resultados.');return;}
  const rows=sceneRows(scene),s=stats(rows),base=stats(candidatesNow()),p=scene.config?.ahp||null,comp=sceneById($('v17CompareA')?.value)||activeScenes().find(x=>x.id!==scene.id);
  const selected=new Set(rows.map(r=>r._cui));const excluded=candidatesNow().filter(r=>!selected.has(r._cui));
  const changes=comp?sensitivityRows(comp,scene):null,comparisonCheck=comp?window.ESC_V17?.comparable?.(comp,scene):null;
  const td=(x)=>`<td>${hSafe(x)}</td>`;
  const weights=p?.keys?.map((k,i)=>`<tr>${td(factors[k]?.title||k)}${td((100*p.weights[i]).toFixed(2)+' %')}</tr>`).join('')||'<tr><td colspan="2">No se aplicó AHP en este escenario</td></tr>';
  const table=rows.map(r=>`<tr>${[r._cui,r._region,r._province,r._district,r._pliegoDisplay,r._bridges,money(r._deficit),money(r._canonApplied),money(r._deficitNet),r._ahpScore==null?'—':Number(r._ahpScore).toFixed(2)].map(td).join('')}</tr>`).join('');
  const evidence=compareHistory.map(r=>{const a=sceneById(r.baseline),b=sceneById(r.result);if(!a||!b)return '';const d=sensitivityRows(a,b);return `<tr>${[r.name,`${((r.rate-1)*100).toFixed(0)} %`,a.name,b.name,`${d.sb.n-d.sa.n}`,`${d.sb.bridges-d.sa.bridges}`,`${d.entered.length} / ${d.exited.length}`].map(td).join('')}</tr>`;}).join('');
  const totalCanon=scene.rows.reduce((sum,r)=>sum+val(r.canon),0);
  const title='Cartera priorizada · Ley N.° 32416';
  const page=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>@page{size:A4 landscape;margin:15mm}body{font:13px/1.55 Arial,sans-serif;color:#253e50;margin:36px auto;max-width:1400px;padding:0 28px}h1{color:#8d183d;font-size:28px}h2{color:#263f58;border-bottom:2px solid #8d183d;padding-bottom:6px;margin-top:30px}h3{color:#304f68}p{margin:9px 0}table{border-collapse:collapse;width:100%;font-size:11px;margin:12px 0}th{background:#304f68;color:white;text-align:left}td,th{padding:7px;border:1px solid #dce4eb}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.kpis div{border:1px solid #dce4eb;border-top:4px solid #8d183d;padding:13px;border-radius:8px}.kpis strong{display:block;font-size:21px;color:#8d183d}.muted{color:#738397}.foot{margin-top:30px;border-top:1px solid #ddd;padding-top:10px}.print{padding:10px 18px;background:#8d183d;color:white;border:0;cursor:pointer}@media print{.print{display:none}body{padding:0;margin:0}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body><button class="print" onclick="print()">Imprimir o guardar como PDF</button><p class="muted">Gerencia de Monitoreo y Seguimiento · Ley N.° 32416</p><h1>${title}</h1><p><strong>${hSafe(scene.name)}</strong> · Generado: ${new Date().toLocaleString('es-PE')} · Objetivo: ${hSafe(scene.goalLabel||scene.criterion||'No indicado')} · Resultado: ${scene.optimal?'Óptimo acreditado':'Factible; optimalidad no acreditada'}</p><h2>1. Resultado de la decisión</h2><div class="kpis"><div>IOARR priorizadas<strong>${fmt(s.n)}</strong><small>De ${fmt(base.n)} candidatas actuales</small></div><div>Puentes<strong>${fmt(s.bridges)}</strong></div><div>Financiamiento adicional<strong>${mini(s.net)}</strong></div><div>Canon aplicado<strong>${mini(totalCanon)}</strong></div></div><p>${fmt(s.regions)} regiones, ${fmt(s.provinces)} provincias y ${fmt(s.districts)} distritos representados. Déficit bruto de la cartera: ${money(s.gross)}. Presupuesto configurado: ${money(scene.config?.budget)}.</p><h2>2. Criterios y configuración</h2><p>Regla de selección: <b>${hSafe(scene.config?.rule||'No indicada')}</b>. Emergencia PCM: ${scene.config?.conditions?.filterFem?'Solo declarados':'Sin restricción específica'}. Riesgo CENEPRED: ${hSafe(scene.config?.conditions?.v16Risk||'Todos')}. Canon: ${scene.config?.conditions?.assistCanon?'Aplicado conforme a la configuración':'Sin aporte opcional'}.</p><table><thead><tr><th>Criterio</th><th>Peso aplicado</th></tr></thead><tbody>${weights}</tbody></table><p>${p?`Razón de consistencia del AHP original: ${((p.cr||0)*100).toFixed(2)} %. Los pesos reflejan preferencias de decisión, no una validación institucional automática.`:'La cartera se obtuvo sin un perfil AHP registrado; se usaron las otras reglas y el objetivo de optimización configurado.'}</p><h2>3. Comparación de alternativas</h2>${changes?`<p>${comparisonCheck?.ok?'Comparación bajo el mismo universo y presupuesto.':'Comparación descriptiva, sin equivalencia metodológica: '+hSafe(comparisonCheck?.why||'verificar condiciones')+'.'} Respecto al escenario <b>${hSafe(comp.name)}</b>, variación: ${s.n-changes.sa.n>=0?'+':''}${fmt(s.n-changes.sa.n)} IOARR, ${s.bridges-changes.sa.bridges>=0?'+':''}${fmt(s.bridges-changes.sa.bridges)} puentes y ${money(s.net-changes.sa.net)} de financiamiento adicional. Ingresan ${changes.entered.length} CUI y salen ${changes.exited.length}. Estas diferencias no son automáticamente mejoras en todas las dimensiones: deben interpretarse según el objetivo seleccionado.</p>`:'<p>No existe una alternativa adicional guardada para comparar resultados. Se presenta la cartera seleccionada y su configuración.</p>'}<h2>4. Sensibilidad de los factores</h2>${evidence?`<table><thead><tr><th>Factor</th><th>Variación relativa de peso</th><th>Base</th><th>Alternativa</th><th>Δ IOARR</th><th>Δ Puentes</th><th>Ingresan / salen</th></tr></thead><tbody>${evidence}</tbody></table>`:'<p>No se realizaron pruebas de sensibilidad multicriterio registradas durante esta sesión.</p>'}<h2>5. Inversiones seleccionadas</h2><table><thead><tr>${['CUI','Región','Provincia','Distrito','Pliego','Puentes','Déficit bruto','Canon aplicado','Monto adicional','Puntaje AHP'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${table}</tbody></table><h2>6. Sustento conceptual y formulación</h2><p><b>Priorización multicriterio (AHP):</b> para inversión i: Pᵢ = 100 × Σⱼ (wⱼ × zᵢⱼ); wⱼ ≥ 0 y Σⱼ wⱼ = 1. zᵢⱼ es el indicador normalizado conforme a su dirección de preferencia. La consistencia se comprueba mediante RC = IC / IR e IC = (λₘₐₓ − n) / (n − 1), para n ≥ 3. Una RC ≤ 0.10 es una referencia de coherencia de juicios, no una aprobación técnica del modelo.</p><p><b>Selección financiera (MILP):</b> xᵢ ∈ {0,1} indica inversión seleccionada. El modelo maximiza la función objetivo definida (por ejemplo, Σᵢ Pᵢxᵢ si el objetivo es AHP), sujeto al presupuesto disponible, las reglas de agrupación y la restricción de recursos por pliego. En forma esquemática: Σᵢ (dᵢxᵢ − cᵢ) ≤ B, con 0 ≤ cᵢ ≤ dᵢxᵢ y Σᵢ∈pliego cᵢ ≤ CanonDisponible_pliego. dᵢ es el déficit y cᵢ el canon aplicado a la inversión. La formulación detallada depende de las condiciones activas del solucionador.</p><p><b>Sensibilidad de pesos:</b> w'ₖ = (αwₖ) / (αwₖ + Σⱼ≠ₖ wⱼ); w'ⱼ = wⱼ / (αwₖ + Σⱼ≠ₖ wⱼ). Se mantiene el presupuesto y se vuelve a resolver el modelo para evaluar cambios en composición y cobertura.</p><p><b>Alcance de los indicadores:</b> pobreza, agricultura y niveles de riesgo corresponden al distrito de intervención y no demuestran por sí solos exposición física, beneficiarios específicos ni daño del puente. Los elementos del distrito no deben contarse repetidamente como si fueran beneficiarios diferentes por CUI.</p><p class="foot">Documento generado automáticamente desde el tablero. Para guardar un PDF, utilizar «Imprimir o guardar como PDF». La reproducibilidad depende de conservar la versión de datos de entrada y la configuración asociada al escenario.</p></body></html>`;
  const blob=new Blob(['\ufeff',page],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`cartera_priorizada_ley32416_${scene.name.replace(/[^a-z0-9_-]/gi,'_')}.html`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
 }
 function init(){if(!state?.all?.length){setTimeout(init,200);return;}
   const overview=document.querySelector('.v17-overview'),live=document.querySelector('.esc-live'),originalBase=overview?.querySelector('.esc-base-summary');
   if(overview&&live&&originalBase){const details=document.createElement('details');details.className='esc-base-toggle';details.id='escBaseToggle';details.open=true;const summary=document.createElement('summary');summary.textContent='Indicadores base de la cartera · consultar';originalBase.before(details);details.append(summary,originalBase);overview.append(live);}
   $('escFactorAdjust')?.addEventListener('click',()=>$('mcOpenAhp')?.click());
   $('escSensitivityRun')?.addEventListener('click',runSensitivity);
   $('escDownloadReport')?.addEventListener('click',downloadReport);
   const observe=new MutationObserver(()=>{lastRender='';scheduleRefresh();});
   for(const id of ['baseEligible','metricCount','v20SceneCount'])if($(id))observe.observe($(id),{childList:true,characterData:true,subtree:true});
   let scheduled=false;function scheduleRefresh(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;renderKpis();renderFactors();renderFinal();},110);}
   document.addEventListener('change',scheduleRefresh,true);document.addEventListener('click',e=>{if(e.target.closest('button,select,input'))setTimeout(scheduleRefresh,130);},true);
   document.querySelectorAll('[data-v17-go],[data-v17-prev],[data-v17-next]').forEach(e=>e.addEventListener('click',scheduleRefresh));
   renderKpis();renderFactors();renderFinal();
 }
 document.addEventListener('DOMContentLoaded',()=>setTimeout(init,250));
 window.ESC_DECISION={render:()=>{lastRender='';renderKpis();renderFactors();renderFinal();},sensitivity:runSensitivity,downloadReport};
})();
