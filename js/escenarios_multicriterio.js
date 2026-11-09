/* Módulo de priorización territorial y AHP. No altera los módulos externos.
 * Datos distritales: características del UBIGEO DE INTERVENCIÓN, no del puente.
 * Ponderaciones: sólo por configuración explícita, no existe preset oficial.
 */
(function () {
  'use strict';
  const META = {
    poverty: {name:'Pobreza distrital (ranking)',unit:'posición',source:'Ranking de pobreza en JSON entregado',year:'No informado',direction:'Menor ranking = mayor prioridad',dimension:'Socioeconómica'},
    agriculture: {name:'Superficie agrícola distrital',unit:'hectáreas',source:'Área agrícola en JSON entregado',year:'No informado',direction:'Mayor proporción = mayor potencial',dimension:'Productiva'},
    flood: {name:'Riesgo distrital por inundación',unit:'nivel CENEPRED',source:'CENEPRED según JSON entregado',year:'No informado',direction:'Mayor nivel = mayor focalización',dimension:'Riesgo distrital'},
    mass: {name:'Riesgo distrital por movimientos en masa',unit:'nivel CENEPRED',source:'CENEPRED según JSON entregado',year:'No informado',direction:'Mayor nivel = mayor focalización',dimension:'Riesgo distrital'}
  };
  const GROUPS = [
    ['general','Características del distrito',[
      ['POBLACION DISTRITAL','Población (personas)'],['VIVIENDAS DISTRITALES','Viviendas'],
      ['ESTABLECIMIENTOS DE SALUD','Establecimientos de salud'],['INSTITUCIONES EDUCATIVAS','Instituciones educativas'],
      ['AREA AGRICOLA','Área agrícola (ha)'],['INFRAESTRUCTURA VIAL DISTRITAL','Infraestructura vial (unidad por verificar)']]],
    ['flood','En áreas de mayor susceptibilidad: inundación',[
      ['VIVIENDAS EN AREAS DE MAYOR SUSCEPTIBILIDAD INUNDACIONES','Viviendas'],
      ['ESTABLECIMIENTOS SALUD EN AREAS DE MAYOR SUSCEPTIBILIDAD INUNDACIONES','Establecimientos de salud'],
      ['INSTITUCIONES EDUCATIVAS EN AREAS DE MAYOR SUSCEPTIBILIDAD INUNDACIONES','Instituciones educativas'],
      ['SUPERFICIE AGRICOLA EN AREAS DE MAYOR SUSCEPTIBILIDAD INUNDACIONES','Área agrícola (ha)'],
      ['VÍAS EN AREAS DE MAYOR SUSCEPTIBILIDAD INUNDACIONES','Vías (unidad por verificar)']]],
    ['mass','En áreas de mayor susceptibilidad: movimientos en masa',[
      ['VIVIENDAS EN AREAS DE MAYOR SUSCEPTIBILIDAD MOVIMIENTOS DE MASA','Viviendas'],
      ['ESTABLECIMIENTOS SALUD EN AREAS DE MAYOR SUSCEPTIBILIDAD MOVIMIENTOS DE MASA','Establecimientos de salud'],
      ['INSTITUCIONES EDUCATIVAS EN AREAS DE MAYOR SUSCEPTIBILIDAD MOVIMIENTOS DE MASA','Instituciones educativas'],
      ['SUPERFICIE AGRÍCOLA EN AREAS DE MAYOR SUSCEPTIBILIDAD MOVIMIENTOS DE MASA','Área agrícola (ha)'],
      ['VIAS EN AREAS DE MAYOR SUSCEPTIBILIDAD MOVIMIENTOS DE MASA','Vías (unidad por verificar)']]]
  ];
  const $ = id => document.getElementById(id);
  const text = v => String(v ?? '').trim();
  const es = v => text(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const n = v => (v===null || v===undefined || v==='')?null:Number.isFinite(Number(v))?Number(v):null;
  const format = (v,d=0) => v==null?'No determinado':Number(v).toLocaleString('es-PE',{maximumFractionDigits:d});
  const money = v => v==null?'No determinado':`S/ ${Number(v).toLocaleString('es-PE',{maximumFractionDigits:2,minimumFractionDigits:2})}`;
  const unique = rows => [...new Map(rows.filter(r=>r&&r._districtCode).map(r=>[r._districtCode,r])).values()];
  const isHigh = v => ['ALTO','MUY ALTO'].includes(text(v).toUpperCase());
  const riskScore = v => ({BAJO:0,MEDIO:.5,ALTO:.85,'MUY ALTO':1})[text(v).toUpperCase()] ?? null;
  const qNumber = v => ({'PRIMER QUINTIL':1,'SEGUNDO QUINTIL':2,'TERCER QUINTIL':3,'CUARTO QUINTIL':4,'QUINTO QUINTIL':5, '1':1,'2':2,'3':3,'4':4,'5':5})[text(v).toUpperCase()]??null;
  const configKey='pml32416-ahp-profiles-v15';
  let context=null, refresh=null, currentProfile=null, activeAhp=null, expertJudgments=[], ranked=[], stored=[];
  let activeKeys=['poverty','agriculture'];
  let matrixPairValues={};
  let mapVersion=0;const mapValuesCache=new Map();
  let fixedLimits={poverty:[1,1831], agriculture:[0,1]};

  function riskLevel(row,hazard='either') {
    const flood=isHigh(row['NIVEL DE RIESGO POR INUNDACIONES']);
    const mass=isHigh(row['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA']);
    if(hazard==='flood')return flood;
    if(hazard==='mass')return mass;
    if(hazard==='both')return flood&&mass;
    return flood||mass;
  }
  function povertyQuintile(row){return qNumber(row['QUINTIL POBREZA']);}
  function agriculturePercent(row){const x=n(row['PORCENTAJE AREA AGRICOLA CON RESPECTO A LA PROVINCIA']);return x==null?null:x*100;}
  function matchesCondition(row,kind) {
    if(kind==='poverty')return povertyQuintile(row)!=null&&povertyQuintile(row)<=Number($('mcPovertyQuintile')?.value||2);
    if(kind==='risk')return riskLevel(row,$('mcRiskHazard')?.value||'either');
    if(kind==='agriculture'){const p=agriculturePercent(row);return p!=null&&p>=Number($('mcAgriMin')?.value||0);}
    return false;
  }
  function modes(){return {poverty:$('mcPovertyMode')?.value||'inform',risk:$('mcRiskMode')?.value||'inform',agriculture:$('mcAgriMode')?.value||'inform'};}
  function condition(row) {
    const m=modes();
    return Object.entries(m).every(([k,v])=>v!=='restrict'||matchesCondition(row,k));
  }
  function exclusionReason(row){
    const m=modes();
    for(const [k,label] of [['poverty','pobreza'],['risk','riesgo distrital'],['agriculture','superficie agrícola']]){
      if(m[k]==='restrict'&&!matchesCondition(row,k))return `No cumple la restricción territorial de ${label} o falta información verificable`;
    }
    return '';
  }
  function focusTier(row){
    const m=modes();
    let count=0;
    for(const key of Object.keys(m)) if(m[key]==='focus'&&matchesCondition(row,key))count+=1;
    return count;
  }
  function scoreOf(row){
    if(!activeAhp)return null;
    const vals=activeAhp.keys.map(k=>{
      if(k==='poverty'){
        const x=n(row['RANKING POBREZA']);if(x==null)return null;
        const [lo,hi]=fixedLimits.poverty;return Math.max(0,Math.min(1,1-(x-lo)/Math.max(1,hi-lo)));
      }
      if(k==='agriculture'){
        const x=n(row['AREA AGRICOLA']);if(x==null)return null;
        const [lo,hi]=fixedLimits.agriculture;return Math.max(0,Math.min(1,Math.log1p(Math.max(0,x))/Math.log1p(Math.max(1,hi))));
      }
      if(k==='flood')return riskScore(row['NIVEL DE RIESGO POR INUNDACIONES']);
      if(k==='mass')return riskScore(row['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA']);
      return null;
    });
    if(vals.some(v=>v==null))return null;
    return vals.reduce((a,v,i)=>a+v*activeAhp.weights[i],0)*100;
  }
  function allScores(){if(!context)return;for(const row of context.all)row._ahpScore=scoreOf(row);ranked=context.eligible.filter(r=>r._ahpScore!=null).sort((a,b)=>b._ahpScore-a._ahpScore||a._cui.localeCompare(b._cui));ranked.forEach((r,i)=>r._ahpRank=i+1);}
  function describe(row){return {povertyQuintile:povertyQuintile(row),agriPercent:agriculturePercent(row),riskFlood:row['NIVEL DE RIESGO POR INUNDACIONES'],riskMass:row['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA'],ahpScore:row._ahpScore??null,ahpRank:row._ahpRank??null,exclusionReason:exclusionReason(row)};}

  function computeAHP(matrix){
    const size=matrix.length;if(size<2)return {weights:[1],lambda:size,ci:0,cr:0};
    let w=Array(size).fill(1/size);let next;
    for(let j=0;j<500;j++){
      next=matrix.map(a=>a.reduce((sum,x,k)=>sum+x*w[k],0));
      const total=next.reduce((a,b)=>a+b,0);next=next.map(x=>x/total);
      if(next.every((x,i)=>Math.abs(x-w[i])<1e-12)){w=next;break;}
      w=next;
    }
    const lam=matrix.reduce((sum,line,i)=>sum+line.reduce((z,x,k)=>z+x*w[k],0)/w[i],0)/size;
    const ci=(lam-size)/(size-1);
    const ris={2:0,3:.58,4:.9,5:1.12,6:1.24,7:1.32,8:1.41,9:1.45};
    const cr=size<3?0:Math.max(0,ci)/(ris[size]||1.49);
    return {weights:w,lambda:lam,ci,cr};
  }
  function values(){return activeKeys.slice();}
  function pairChoices(value){
    const opts=[];
    for(let x=9;x>=2;x--)opts.push([1/x,`La derecha importa ${x} veces más`]);
    opts.push([1,'Ambos igualmente importantes']);
    for(let x=2;x<=9;x++)opts.push([x,`La izquierda importa ${x} veces más`]);
    return opts.map(([v,l])=>`<option value="${v}" ${Math.abs(v-value)<1e-6?'selected':''}>${l}</option>`).join('');
  }
  // Jerarquía de dos niveles: Pobreza / Agricultura / Riesgo.
  // Cuando ambos peligros están activos comparten el peso de la dimensión Riesgo.
  function dimensions(keys=values()){
    const map={poverty:'poverty',agriculture:'agriculture',flood:'risk',mass:'risk'};
    return [...new Set(keys.map(k=>map[k]))];
  }
  function dimensionLabel(key){return {poverty:'Pobreza',agriculture:'Potencial agrícola',risk:'Riesgo territorial CENEPRED'}[key]||key;}
  function matrixFromPairs(keys,prefix=''){
    return keys.map((a,i)=>keys.map((b,j)=>i===j?1:i<j?(matrixPairValues[`${prefix}${a}|${b}`]||1):1/(matrixPairValues[`${prefix}${b}|${a}`]||1)));
  }
  function currentHierarchy(){
    const keys=values(),dims=dimensions(keys);
    const riskKeys=keys.filter(k=>k==='flood'||k==='mass');
    return {keys,dims,riskKeys,dimensionMatrix:matrixFromPairs(dims,'dim:'),riskMatrix:matrixFromPairs(riskKeys,'risk:')};
  }
  function currentEvaluation(){
    const cur=currentHierarchy(),experts=expertJudgments.filter(e=>JSON.stringify(e.keys)===JSON.stringify(cur.keys));
    const aggregate=(matrices)=>matrices.length?matrices[0].map((row,i)=>row.map((_,j)=>Math.exp(matrices.reduce((acc,m)=>acc+Math.log(m[i][j]),0)/matrices.length))):null;
    const dims=aggregate(experts.map(e=>e.dimensionMatrix))||cur.dimensionMatrix;
    const risks=aggregate(experts.map(e=>e.riskMatrix))||cur.riskMatrix;
    const d=computeAHP(dims),risk=computeAHP(risks);
    const weights=cur.keys.map(k=>{
      const dim=(k==='flood'||k==='mass')?'risk':k;
      const local=dim==='risk'?risk.weights[cur.riskKeys.indexOf(k)]:1;
      return d.weights[cur.dims.indexOf(dim)]*local;
    });
    const cr=Math.max(d.cr,risk.cr);
    return {keys:cur.keys,dims:cur.dims,riskKeys:cur.riskKeys,dimensionMatrix:dims,riskMatrix:risks,
      weights,dimensionWeights:d.weights,localRiskWeights:risk.weights,
      dimensionCR:d.cr,riskCR:risk.cr,cr,
      matrix:weights.map((a,i)=>weights.map((b,j)=>a/b)),
      experts:experts.length};
  }
  function refreshAHP(){
    const result=currentEvaluation();
    if(result.keys.length<2){$('mcAhpCr').textContent='Selecciona al menos 2 criterios';$('mcWeights').innerHTML='';return;}
    const p=(result.cr*100).toFixed(1);
    $('mcAhpCr').textContent=`RC máxima: ${p} % (dimensiones ${(result.dimensionCR*100).toFixed(1)} %, subcriterios ${(result.riskCR*100).toFixed(1)} %) ${result.cr>.10?'· REVISAR':'· adecuada'}`;
    $('mcAhpCr').className='esc-mc-consistency '+(result.cr>.10?'esc-mc-warning':'esc-mc-good');
    $('mcWeights').innerHTML='<div class="esc-mc-weights">'+result.keys.map((k,i)=>`<div><b>${es(META[k].name)}</b><strong>${(100*result.weights[i]).toFixed(2)} %</strong><span style="width:${result.weights[i]*100}%"></span></div>`).join('')+'</div>';
    const possible=context.eligible.map(r=>({row:r,score:temporaryScore(r,result)})).filter(x=>x.score!=null).sort((a,b)=>b.score-a.score);
    $('mcRankingPreview').innerHTML=`<p><b>${possible.length}</b> inversiones evaluables; <b>${context.eligible.length-possible.length}</b> sin puntaje por campo faltante. ${result.cr>.10?'Los juicios requieren revisión: consistencia superior al 10 %.':'Los juicios cumplen el umbral de consistencia.'}</p><div class="esc-mc-ranking">${possible.slice(0,8).map((r,i)=>`<div><b>${i+1}. ${es(r.row._cui)}</b><span>${r.score.toFixed(1)} / 100</span></div>`).join('')}</div>`;
    $('mcExperts').innerHTML=expertJudgments.length?`<small>Juicios almacenados: ${expertJudgments.map(e=>`${es(e.name)} (RC ${(e.cr*100).toFixed(1)} %)`).join(' · ')}. Se agregan por media geométrica.</small>`:'<small>Sin especialistas agregados: se utiliza el juicio de la matriz visible.</small>';
  }
  function temporaryScore(row,profile){
    const vals=profile.keys.map(k=>k==='poverty'?n(row['RANKING POBREZA'])==null?null:Math.max(0,Math.min(1,1-(Number(row['RANKING POBREZA'])-fixedLimits.poverty[0])/Math.max(1,fixedLimits.poverty[1]-fixedLimits.poverty[0]))):k==='agriculture'?n(row['AREA AGRICOLA'])==null?null:Math.min(1,Math.max(0,Math.log1p(Math.max(0,Number(row['AREA AGRICOLA'])))/Math.log1p(Math.max(1,fixedLimits.agriculture[1])))):riskScore(row[k==='flood'?'NIVEL DE RIESGO POR INUNDACIONES':'NIVEL DE RIESGO POR MOVIMIENTOS DE MASA']));
    return vals.some(x=>x==null)?null:vals.reduce((s,v,i)=>s+v*profile.weights[i],0)*100;
  }
  function redrawPairs(){
    const cur=currentHierarchy(),rows=[];
    const add=(keys,prefix,label,labels)=>{
      for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){
        const pair=`${prefix}${keys[i]}|${keys[j]}`;
        rows.push(`<label class="esc-mc-pair"><span>${es(labels(keys[i]))}</span><small>o</small><span>${es(labels(keys[j]))}</span><select aria-label="Importancia comparada entre ${es(labels(keys[i]))} y ${es(labels(keys[j]))}" data-pair="${pair}">${pairChoices(matrixPairValues[pair]||1)}</select></label>`);
      }
    };
    rows.push('<div class="esc-mc-level"><b>Nivel 1: dimensiones</b><small>Pobreza y quintil son una única dimensión. Riesgo se pondera una sola vez aunque considere dos peligros.</small></div>');
    add(cur.dims,'dim:','Dimensiones',dimensionLabel);
    if(cur.riskKeys.length>1){
      rows.push('<div class="esc-mc-level"><b>Nivel 2: riesgo distrital</b><small>Pesos locales por peligro; multiplicados por el peso global de Riesgo.</small></div>');
      add(cur.riskKeys,'risk:','Subcriterios',k=>META[k].name);
    }
    $('mcPairsTable').innerHTML=rows.join('');
    $('mcPairsTable').querySelectorAll('[data-pair]').forEach(el=>el.addEventListener('change',e=>{matrixPairValues[e.target.dataset.pair]=Number(e.target.value);expertJudgments=[];refreshAHP();}));
    refreshAHP();
  }
  function selectedCriteria(){return [...document.querySelectorAll('[data-mc-criterion]')].filter(x=>x.checked).map(x=>x.dataset.mcCriterion);}
  function profiles(){try{return JSON.parse(localStorage.getItem(configKey)||'[]');}catch(e){return [];}}
  function storeProfiles(){try{localStorage.setItem(configKey,JSON.stringify(stored));}catch(e){$('mcProfileNotice').textContent='El navegador no permitió guardar. La configuración sigue disponible durante la sesión.';}}
  function refreshStored(){const x=$('mcSavedProfiles');x.innerHTML='<option value="">Sin selección</option>'+stored.map((p,i)=>`<option value="${i}">${es(p.name)} · v${es(p.version)} · ${es(p.date)}</option>`).join('');}
  function profileData(){const evalx=currentEvaluation();return {name:text($('mcProfileName').value)||'Sin nombre',author:text($('mcProfileAuthor').value)||'No identificado',version:text($('mcProfileVersion').value)||'1.0',date:new Date().toISOString().slice(0,10),mode:$('mcAhpMode').value,validation:'Configuración exploratoria; no aprobada',...evalx};}
  function loadProfile(p){if(!p)return;currentProfile=p;activeKeys=p.keys.slice();document.querySelectorAll('[data-mc-criterion]').forEach(x=>x.checked=activeKeys.includes(x.dataset.mcCriterion));matrixPairValues={};if(p.dimensionMatrix){for(let i=0;i<p.dims.length;i++)for(let j=i+1;j<p.dims.length;j++)matrixPairValues[`dim:${p.dims[i]}|${p.dims[j]}`]=p.dimensionMatrix[i][j];for(let i=0;i<p.riskKeys.length;i++)for(let j=i+1;j<p.riskKeys.length;j++)matrixPairValues[`risk:${p.riskKeys[i]}|${p.riskKeys[j]}`]=p.riskMatrix[i][j];}expertJudgments=[];$('mcProfileName').value=p.name;$('mcProfileAuthor').value=p.author;$('mcProfileVersion').value=p.version;$('mcAhpMode').value=p.mode||'personal';redrawPairs();}
  function saveCurrent(){const p=profileData();stored.push(p);storeProfiles();refreshStored();$('mcSavedProfiles').value=String(stored.length-1);$('mcProfileNotice').textContent='Configuración guardada en este navegador como borrador. No implica validación oficial.';}
  function rowInfo(key,val){return `<div><span>${es(key)}</span><b>${es(val)}</b></div>`;}
  function statsByDistrict(rows){
    const districts=unique(rows), allSelected=rows.length;
    const sums={};for(const [grp,,items] of GROUPS) for(const [key] of items){const col=districts.map(r=>n(r[key]));sums[key]=col.some(v=>v==null)?null:col.reduce((acc,x)=>acc+x,0);}
    const vulnerable=districts.filter(r=>povertyQuintile(r)!=null&&povertyQuintile(r)<=2);
    const highFlood=districts.filter(r=>isHigh(r['NIVEL DE RIESGO POR INUNDACIONES']));
    const highMass=districts.filter(r=>isHigh(r['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA']));
    const highBoth=districts.filter(r=>isHigh(r['NIVEL DE RIESGO POR INUNDACIONES'])&&isHigh(r['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA']));
    const financedVulnerable=rows.filter(r=>povertyQuintile(r)!=null&&povertyQuintile(r)<=2).reduce((acc,r)=>acc+(r._deficitNet||0),0);
    const totalFinance=rows.reduce((acc,r)=>acc+(r._deficitNet||0),0);
    return {districts, sums, count:districts.length,selected:allSelected,vulnerable:vulnerable.length,highFlood:highFlood.length,highMass:highMass.length,highEither:new Set([...highFlood,...highMass].map(r=>r._districtCode)).size,highBoth:highBoth.length,financedVulnerable,financePct:totalFinance?100*financedVulnerable/totalFinance:0,scoreSum:districts.reduce((acc,r)=>acc+(r._ahpScore||0),0),evaluatedAHP:rows.filter(r=>r._ahpScore!=null).length};
  }
  function renderDiagnostics(){
    if(!context)return;
    mapVersion++;mapValuesCache.clear();
    const rows=context.scenario;const d=statsByDistrict(rows);
    $('mcDistrictBadge').textContent=`${format(d.count)} distritos`;const parts=[];
    parts.push(`<div class="esc-mc-stats"><div><small>IOARR seleccionadas</small><strong>${format(d.selected)}</strong></div><div><small>Distritos distintos</small><strong>${format(d.count)}</strong></div><div><small>Distritos en quintiles 1–2</small><strong>${format(d.vulnerable)}</strong></div><div><small>Distritos con riesgo alto en algún peligro</small><strong>${format(d.highEither)}</strong></div><div><small>Ambos peligros altos</small><strong>${format(d.highBoth)}</strong></div><div><small>Financiamiento en distritos vulnerables</small><strong>${format(d.financePct,1)} %</strong></div></div>`);
    for(const [k,title,items] of GROUPS){
      const rows2=items.map(([key,label])=>{
        const val=d.sums[key];
        const denom=key.includes('VIVIENDAS ')?d.sums['VIVIENDAS DISTRITALES']:key.includes('SALUD EN AREAS')?d.sums['ESTABLECIMIENTOS DE SALUD']:key.includes('EDUCATIVAS EN AREAS')?d.sums['INSTITUCIONES EDUCATIVAS']:key.includes('AGRICOLA EN AREAS')||key.includes('AGRÍCOLA EN AREAS')?d.sums['AREA AGRICOLA']:null;
        const pct=denom>0 && val!=null?` · ${format(val/denom*100,1)} % del total distrital` : '';
        return rowInfo(label,`${format(val,2)}${pct}`);
      }).join('');
      parts.push(`<section class="esc-mc-sumgroup"><h4>${es(title)}</h4><div>${rows2}</div></section>`);
    }
    parts.push('<p class="esc-mc-disclaimer">Los indicadores describen los distritos de intervención, deduplicados por UBIGEO. No identifican beneficiarios, infraestructura protegida ni daño del puente. Las unidades/años no informados requieren conciliación con las fuentes oficiales. Las exposiciones a inundación y a movimientos en masa pueden superponerse; no se suman.</p>');
    $('mcDiagBody').innerHTML=parts.join('');
    const m=modes(),focus=Object.keys(m).filter(k=>m[k]==='focus'),restrict=Object.keys(m).filter(k=>m[k]==='restrict');
    $('mcModeStatus').textContent=`Focalización: ${focus.length?focus.join(', '):'ninguna'} · Restricciones territoriales: ${restrict.length?restrict.join(', '):'ninguna'}. Informar no modifica la selección; focalizar orienta la recomendación sin excluir; restringir sí excluye candidatas.`;
    $('mcAHPActive').innerHTML=activeAhp?`Modelo AHP activo: <b>${es(activeAhp.name)}</b> · ${activeAhp.keys.length} criterios · consistencia ${(activeAhp.cr*100).toFixed(1)} % · ${d.evaluatedAHP} IOARR seleccionadas evaluables. Ranking orientativo.`:'Prioridad AHP no aplicada. El modelo personalizado debe configurarse antes de utilizar su puntaje.';
  }
  function cacheMapValues(mode,theme){
    const stamp=`${mapVersion}|${mode}|${theme}`;
    if(mapValuesCache.has(stamp))return mapValuesCache.get(stamp);
    const len=mode==='region'?2:mode==='province'?4:6;
    const allDistricts=unique(context.all), groups=new Map();
    for(const d of allDistricts){
      const key=d._districtCode.slice(0,len);
      if(!groups.has(key))groups.set(key,{districts:[],selected:[]});
      groups.get(key).districts.push(d);
    }
    for(const row of context.scenario){
      const key=row._districtCode.slice(0,len);
      if(!groups.has(key))groups.set(key,{districts:[],selected:[]});
      groups.get(key).selected.push(row);
    }
    const byCode=new Map();
    for(const [key,g] of groups){
      let val=null;
      if(theme==='selected')val=g.selected.length;
      if(theme==='poverty'){const valid=g.districts.map(povertyQuintile).filter(q=>q>=1&&q<=5);val=!valid.length?null:mode==='district'?valid[0]:valid.reduce((a,b)=>a+b,0)/valid.length;}
      if(theme==='agriculture')val=g.districts.some(r=>n(r['AREA AGRICOLA'])!=null)?g.districts.reduce((t,r)=>t+(n(r['AREA AGRICOLA'])||0),0):null;
      if(theme==='flood'||theme==='mass'){
        const field=theme==='flood'?'NIVEL DE RIESGO POR INUNDACIONES':'NIVEL DE RIESGO POR MOVIMIENTOS DE MASA';
        const valid=g.districts.filter(r=>riskScore(r[field])!=null);
        val=!valid.length?null:mode==='district'?riskScore(valid[0][field]):100*valid.filter(r=>isHigh(r[field])).length/valid.length;
      }
      if(theme==='financing')val=g.selected.reduce((t,r)=>t+(r._deficitNet||0),0);
      if(theme==='ahp'){
        if(activeAhp){const scores=g.selected.map(r=>r._ahpScore).filter(x=>x!=null);val=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;}
      }
      byCode.set(key,val);
    }
    const max=Math.max(1,...[...byCode.values()].filter(x=>x!=null));
    const r={byCode,max};
    mapValuesCache.set(stamp,r);
    return r;
  }
  // Cinco clases para pobreza: escala ordinal distrital; las agrupaciones muestran
  // la media de los quintiles de distritos únicos (no la cantidad de IOARR).
  const POVERTY_COLORS=['#8e1739','#c14463','#e3939b','#e9b977','#f3dfad'];
  const RISK_COLORS=['#299660','#efcc43','#ec8d37','#ca4044'];
  function themeInfo(theme,mode){
    const group=mode==='region'?'departamentos':mode==='province'?'provincias':'distritos';
    return {
      selected:['IOARR en el territorio',`Número de inversiones seleccionadas por ${group}.`],
      poverty:['Pobreza distrital · 5 niveles',mode==='district'?'Quintil 1 = mayor pobreza; quintil 5 = menor pobreza.':'Promedio de los quintiles de pobreza de los distritos representados en cada territorio.'],
      agriculture:['Superficie agrícola',`Hectáreas agrícolas de distritos únicos representados en cada ${group.slice(0,-1)}.`],
      flood:['Riesgo distrital por inundación',mode==='district'?'Categoría registrada para el distrito.':'Porcentaje de distritos en riesgo alto o muy alto.'],
      mass:['Riesgo distrital por movimientos en masa',mode==='district'?'Categoría registrada para el distrito.':'Porcentaje de distritos en riesgo alto o muy alto.'],
      financing:['Brecha de financiamiento',`Suma del financiamiento adicional de las inversiones seleccionadas por ${group}.`],
      ahp:['Prioridad multicriterio',`Puntaje AHP promedio de las inversiones seleccionadas por ${group}.`],
      pcm:['Emergencia PCM',`Porcentaje de inversiones con declaratoria PCM por ${group}.`],
      canon:['Canon vinculado a pliegos',`Suma referencial del canon de pliegos presentes en cada ${group.slice(0,-1)}.`]
    }[theme]||['Capa temática','Información del territorio'];
  }
  function legendHTML(theme,mode,max){
    const swatch=(label,color)=>`<span class="v20-legend-item"><i style="background:${color}"></i>${label}</span>`;
    if(theme==='poverty')return '<strong>Pobreza · quintiles</strong><div>'+POVERTY_COLORS.map((col,i)=>swatch(`${i+1} · ${['Muy alta','Alta','Media','Baja','Muy baja'][i]}`,col)).join('')+'</div><small>1 = mayor pobreza · 5 = menor pobreza</small>';
    if(['flood','mass'].includes(theme))return mode==='district'?'<strong>Clasificación distrital</strong><div>'+RISK_COLORS.map((c,i)=>swatch(['Bajo','Medio','Alto','Muy alto'][i],c)).join('')+'</div>':'<strong>Distritos con riesgo alto / muy alto</strong><div>'+RISK_COLORS.map((c,i)=>swatch(['0–24 %','25–49 %','50–74 %','75–100 %'][i],c)).join('')+'</div>';
    const isMoney=['financing','canon'].includes(theme),isArea=theme==='agriculture';
    const unit=isMoney?'S/ ':'';const suffix=isArea?' ha':theme==='ahp'||theme==='pcm'?' %':'';
    const fmt=v=>Number(v).toLocaleString('es-PE',{maximumFractionDigits:v>10?0:1});
    return `<strong>${themeInfo(theme,mode)[0]}</strong><div class="v20-gradient"><span>Bajo · ${unit}0${suffix}</span><i></i><span>Alto · ${unit}${fmt(max||0)}${suffix}</span></div>`;
  }
  let lastMapLegendSignature='',lastMapHeaderSignature='';
  function mapLayerConfig(){
    const theme=$('mcMapLayer')?.value||'selected';
    const mode=context?.mapView||'region';
    const [title,description]=themeInfo(theme,mode);
    const legend=$('v18HeatLegend');
    const values=context?cacheMapValues(mode,theme):{max:0};
    const sig=`${theme}|${mode}|${mapVersion}|${values.max}`;
    if(legend&&sig!==lastMapLegendSignature){lastMapLegendSignature=sig;legend.hidden=false;legend.innerHTML=legendHTML(theme,mode,theme==='poverty'?5:values.max);}
    const headerSig=`${theme}|${mode}`;
    if(headerSig!==lastMapHeaderSignature){lastMapHeaderSignature=headerSig;
      $('mcMapLegend').textContent=description;
      const story=$('v20MapStory');if(story)story.innerHTML=`<strong>${es(title)}</strong><span>${es(description)}</span>`;
      const footer=document.querySelector('.esc-map-footer');if(footer)footer.hidden=theme!=='selected';
    }
    document.body.classList.toggle('esc-is-thematic',theme!=='selected');
    return theme;
  }
  function mapStyle(mode,code){
    const theme=mapLayerConfig();
    if(theme==='selected')return null;
    const cached=cacheMapValues(mode,theme),val=cached.byCode.get(code);
    if(val==null)return {fill:'#e8edf1',value:null};
    if(theme==='poverty')return {fill:POVERTY_COLORS[Math.max(0,Math.min(4,Math.round(val)-1))],value:val};
    if(theme==='flood'||theme==='mass'){
      const score=mode==='district'?val:val/100;
      const idx=mode==='district'?(score<.25?0:score<.7?1:score<.97?2:3):(score<.25?0:score<.5?1:score<.75?2:3);
      return {fill:RISK_COLORS[idx],value:val};
    }
    const ratio=theme==='ahp'||theme==='pcm'?Math.min(1,val/100):Math.min(1,Math.sqrt(val/Math.max(1,cached.max)));
    return {fill:`hsl(341 61% ${Math.round(88-47*ratio)}%)`,value:val};
  }
  function tooltip(mode,code){
    const theme=$('mcMapLayer')?.value||'selected';if(theme==='selected')return '';
    const val=cacheMapValues(mode,theme).byCode.get(code);
    if(val==null)return '<div class="esc-mc-map-info"><b>Sin información para esta capa</b></div>';
    let label='';
    if(theme==='poverty')label=mode==='district'?`Quintil ${Math.round(val)} de 5 · ${['Mayor pobreza','Pobreza alta','Pobreza media','Pobreza baja','Menor pobreza'][Math.round(val)-1]}`:`Quintil promedio ${format(val,2)} de 5`;
    else if(theme==='agriculture')label=`${format(val,1)} hectáreas agrícolas`;
    else if(theme==='flood'||theme==='mass')label=mode==='district'?['Bajo','Medio','Alto','Muy alto'][val<.25?0:val<.7?1:val<.97?2:3]:`${format(val,1)} % de distritos con riesgo alto / muy alto`;
    else if(theme==='financing'||theme==='canon')label=money(val);
    else if(theme==='ahp')label=`${format(val,1)} / 100 puntos AHP`;
    else if(theme==='pcm')label=`${format(val,0)} % de IOARR en declaratoria PCM`;
    return `<div class="esc-mc-map-info"><b>${es(label)}</b><small>${es(themeInfo(theme,mode)[0])}</small></div>`;
  }
  function resetEqualWeights(){matrixPairValues={};expertJudgments=[];redrawPairs();}
  function restoreScenarioAHP(saved){
    if(saved?.keys?.length>=2&&Array.isArray(saved.weights)&&saved.keys.length===saved.weights.length){
      activeAhp={...saved,name:saved.name||'Modelo del escenario',status:'Modelo recuperado del escenario'};
      activeKeys=saved.keys.slice();allScores();if(refresh)refresh(true);return;
    }
    activeAhp=null;for(const r of context?.all||[]){r._ahpScore=null;r._ahpRank=null;}if(refresh)refresh(true);
  }
  function renderComparisonMore(results){
    const host=$('mcComparisonMore');if(!host)return;
    const columns=['Alternativa','Distritos','Quintil 1–2','Riesgo alto','Canon considerado','Fondos adicionales','Puntaje AHP distrital acumulado'];
    host.innerHTML=`<div class="esc-mc-compare-scroll"><table class="esc-mc-compare-table"><thead><tr>${columns.map(c=>`<th>${es(c)}</th>`).join('')}</tr></thead><tbody>${results.filter(r=>r.rule!=='priorizada'||r.rows.length).map(r=>{
      const d=statsByDistrict(r.rows);const canon=r.rows.reduce((a,b)=>a+(b._canonApplied||0),0);const funds=r.rows.reduce((a,b)=>a+(b._deficitNet||0),0);
      const vals=[r.label,d.count,d.vulnerable,d.highEither,money(canon),money(funds),activeAhp?format(d.scoreSum,2):'No aplicado'];
      return `<tr>${vals.map(v=>`<td>${es(v)}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div><p class="esc-mc-disclaimer">Los distritos, pobreza y riesgo se cuentan una sola vez por UBIGEO. Los puntajes AHP se agregan una sola vez por distrito para esta comparación; no son beneficios monetarios.</p>`;
  }
  function renderCuiVariation(current,proposed){
    const host=$('mcVariationCui');if(!host)return;
    const before=new Set(current.map(r=>r._cui)),after=new Set(proposed.map(r=>r._cui));
    const entries=proposed.filter(r=>!before.has(r._cui));
    const exits=current.filter(r=>!after.has(r._cui));
    host.innerHTML=`<details class="esc-mc-cui-variation"><summary>Cambios por CUI: ${entries.length} incorporaciones y ${exits.length} salidas</summary><div class="esc-mc-swap"><div><h4>Ingresan</h4><p>${entries.length?entries.slice(0,60).map(r=>es(r._cui)).join(' · '):'No hay ingresos'}</p></div><div><h4>Salen</h4><p>${exits.length?exits.slice(0,60).map(r=>es(r._cui)).join(' · '):'No hay salidas'}</p></div></div><small>Se muestran hasta 60 CUI por lado; el detalle completo se conserva en los registros exportables.</small></details>`;
  }
  function cuiModal(row){
    if(!row)return;
    $('mcCuiTitle').textContent=`CUI ${row._cui}`;
    const riskF=row['NIVEL DE RIESGO POR INUNDACIONES'],riskM=row['NIVEL DE RIESGO POR MOVIMIENTOS DE MASA'];
    const select=context.scenario.find(r=>r._cui===row._cui);
    const cells=[
      ['Inversión',[
        ['Denominación',row['DENOMINACION DE LA INVERSION']||row.denominacion_inversion||'No determinada'],['Ubicación de intervención',`${row._region} · ${row._province} · ${row._district} · ${row._districtCode}`],['Pliego / unidad ejecutora',row._pliegoDisplay],['UBIGEO UE',row['UBIGEO UE']||'No informado'],['Puentes',row._bridges],['Longitud total',`${format(row._lengthTotal,1)} m`],['Costo actualizado',money(row._cost)],['Déficit original',money(row._deficit)]]],
      ['Financiamiento',[
        ['Canon del pliego (referencial)',money(context.canonByPliego.get(row._pliego)?.positiveValues?.reduce((a,b)=>Math.max(a,b),0)||0)],['Canon aplicado en esta cartera',select?money(select._canonApplied):'No aplica a esta selección'],['Financiamiento adicional requerido',select?money(select._deficitNet):'No determinado'],['PIA 2027 informado',money(n(row['PIA 2027']))]]],
      ['Contexto distrital',[
        ['Ranking pobreza',format(n(row['RANKING POBREZA']))],['Quintil pobreza',row['QUINTIL POBREZA']],['Área agrícola (ha)',format(n(row['AREA AGRICOLA']),1)],['Riesgo distrital inundación',riskF],['Riesgo distrital movimientos en masa',riskM],['Población distrital',format(n(row['POBLACION DISTRITAL']))],['Viviendas distritales',format(n(row['VIVIENDAS DISTRITALES']))],['Viviendas en zonas de mayor susceptibilidad por inundación',format(n(row['VIVIENDAS EN AREAS DE MAYOR SUSCEPTIBILIDAD INUNDACIONES']))],['Viviendas en zonas de mayor susceptibilidad por movimientos en masa',format(n(row['VIVIENDAS EN AREAS DE MAYOR SUSCEPTIBILIDAD MOVIMIENTOS DE MASA']))]]],
      ['Resultado de la cartera',[
        ['Condición',select?'Seleccionada':row._deficit>0?'Elegible no seleccionada':'No elegible'],['Puntaje AHP',row._ahpScore==null?'No determinado':format(row._ahpScore,2)+' / 100'],['Posición AHP',row._ahpRank??'No determinada'],['Motivo de no selección',select?'No corresponde':context.auditRows?.find(r=>r._cui===row._cui)?._auditReason||exclusionReason(row)||'No determinada'],['Beneficiarios específicos del puente','No determinados'],['Riesgo físico del emplazamiento','No determinado']]]
    ];
    $('mcCuiBody').innerHTML=cells.map(([title,rows])=>`<section class="esc-mc-cui-section"><h3>${es(title)}</h3><div>${rows.map(([a,b])=>rowInfo(a,b)).join('')}</div></section>`).join('')+'<p class="esc-mc-disclaimer">Indicadores de pobreza, superficie agrícola, exposición y riesgo proceden del distrito de intervención; no equivalen a población, infraestructura o superficie beneficiaria del puente. Fuente: base JSON entregada. Año no informado en los registros.</p>';
    $('mcCuiModal').hidden=false;
  }
  function isActive(){return !!activeAhp;}
  function open(){ $('mcAhpModal').hidden=false;redrawPairs(); }
  function close(){$('mcAhpModal').hidden=true;}
  function init(st,onChange){
    context=st;refresh=onChange;
    stored=profiles();
    const distinct=unique(st.all),ranks=distinct.map(r=>n(r['RANKING POBREZA'])).filter(x=>x!=null),ag=distinct.map(r=>n(r['AREA AGRICOLA'])).filter(x=>x!=null);
    fixedLimits={poverty:[Math.min(...ranks),Math.max(...ranks)],agriculture:[0,Math.max(.01,...ag)]};
    $('mcCriteriaCheckboxes').innerHTML=Object.entries(META).map(([key,m])=>`<label class="esc-mc-check"><input type="checkbox" data-mc-criterion="${key}" ${activeKeys.includes(key)?'checked':''}/><span><b>${es(m.name)}</b><small>${es(m.unit)} · ${es(m.source)} · año: ${es(m.year)}<br>${es(m.direction)}</small></span></label>`).join('');
    $('mcMissingData').innerHTML=`<small>${format(st.all.filter(r=>r['AREA AGRICOLA']==null).length)} CUI sin dato de área agrícola. Normalización fija de pobreza (ranking inverso), agricultura (logaritmo de hectáreas) y riesgo (bajo 0, medio 0.5, alto 0.85, muy alto 1). Estas son escalas exploratorias, no institucionales. Los años no figuran en el JSON.</small>`;
    for(const id of ['mcPovertyMode','mcPovertyQuintile','mcRiskMode','mcRiskHazard','mcAgriMode','mcAgriMin']){$(id).addEventListener('change',()=>{onChange();});}
    $('mcOpenAhp').addEventListener('click',open);
    $('mcAhpClose').addEventListener('click',close);
    $('mcAhpModal').addEventListener('click',e=>{if(e.target===$('mcAhpModal'))close();});
    $('mcCuiClose').addEventListener('click',()=>{$('mcCuiModal').hidden=true;});
    $('mcCuiModal').addEventListener('click',e=>{if(e.target===$('mcCuiModal'))$('mcCuiModal').hidden=true;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();$('mcCuiModal').hidden=true;}});
    document.querySelectorAll('[data-mc-criterion]').forEach(x=>x.addEventListener('change',()=>{activeKeys=selectedCriteria();matrixPairValues={};expertJudgments=[];redrawPairs();}));
    $('mcAddExpert').addEventListener('click',()=>{const name=text($('mcExpertName').value);if(!name){$('mcExpertName').focus();return;}const data=currentHierarchy();const evalx={...data,cr:Math.max(computeAHP(data.dimensionMatrix).cr,computeAHP(data.riskMatrix).cr),name};expertJudgments.push(evalx);$('mcExpertName').value='';refreshAHP();});
    $('mcClearExperts').addEventListener('click',()=>{expertJudgments=[];refreshAHP();});
    $('mcSaveProfile').addEventListener('click',saveCurrent);
    $('mcLoadProfile').addEventListener('click',()=>loadProfile(stored[Number($('mcSavedProfiles').value)]));
    $('mcDuplicateProfile').addEventListener('click',()=>{const p=stored[Number($('mcSavedProfiles').value)];if(!p)return;loadProfile({...p,name:p.name+' (copia)',version:p.version+'.1'});});
    $('mcCompareProfiles').addEventListener('click',()=>{
      const b=stored[Number($('mcSavedProfiles').value)],a=currentEvaluation();
      if(!b){$('mcProfileComparison').textContent='Selecciona un modelo guardado para comparar.';return;}
      const weightRows=a.keys.map((k,i)=>{const j=b.keys.indexOf(k);return rowInfo(META[k].name,j<0?'No comparable':`${((a.weights[i]-b.weights[j])*100).toFixed(2)} puntos porcentuales`);}).join('');
      const ranking=(profile)=>context.eligible.map(r=>({cui:r._cui,score:temporaryScore(r,profile)})).filter(x=>x.score!=null).sort((a,b)=>b.score-a.score||a.cui.localeCompare(b.cui)).map(x=>x.cui);
      const present=ranking(a),prior=ranking(b);const top=present.slice(0,10),oldTop=new Set(prior.slice(0,10));
      const newly=top.filter(cui=>!oldTop.has(cui));
      $('mcProfileComparison').innerHTML=`<h4>Variación de pesos frente a «${es(b.name)}»</h4>${weightRows}<p class="esc-mc-profile-delta">En los 10 primeros CUI del ranking, <strong>${newly.length}</strong> no aparecían entre los diez primeros del modelo guardado. ${newly.length?`Ingresan: ${newly.map(es).join(' · ')}`:'No cambia la composición del top 10.'} Se compara sobre la misma cartera y con normalización fija.</p>`;
    });
    $('mcApplyAhp').addEventListener('click',()=>{
      if($('mcAhpMode').value==='expert'&&!expertJudgments.length){$('mcProfileNotice').textContent='Para identificar juicios de especialista, registra por lo menos un juicio con su nombre.';return;}
      const ev=currentEvaluation();if(ev.keys.length<2){$('mcProfileNotice').textContent='Debes activar al menos dos criterios.';return;}
      if(ev.cr>0.10){$('mcProfileNotice').textContent='Revisa las comparaciones: la razón de consistencia supera el 10 %. Ajusta los juicios antes de aplicar.';return;}
      activeAhp={...ev,name:text($('mcProfileName').value)||'Modelo personalizado',status:'Exploratorio, no aprobado',date:new Date().toISOString().slice(0,10),source:'Juicio(s) del usuario'};
      allScores();close();onChange();
    });
    $('mcDisableAhp').addEventListener('click',()=>{activeAhp=null;for(const r of st.all){r._ahpScore=null;r._ahpRank=null;}close();onChange();});
    $('mcMapLayer').addEventListener('change',()=>{if(refresh)refresh(false);});
    $('detailBody').addEventListener('click',e=>{const row=e.target.closest('tr[data-cui]');if(!row)return;cuiModal(context.all.find(r=>r._cui===row.dataset.cui));});
    refreshStored();redrawPairs();renderDiagnostics();
  }
  function applySensitivityWeights(newWeights){
    if(!activeAhp||!Array.isArray(newWeights)||newWeights.length!==activeAhp.keys.length)return false;
    const w=newWeights.map(Number),sum=w.reduce((a,b)=>a+b,0);
    if(!Number.isFinite(sum)||sum<=0||w.some(x=>!Number.isFinite(x)||x<=0))return false;
    activeAhp={...activeAhp,weights:w.map(x=>x/sum),name:activeAhp.name+' · sensibilidad',source:'Perturbación exploratoria de pesos'};
    allScores();return true;
  }
  function restoreActiveWeights(profile){
    activeAhp=profile?{...profile,weights:[...profile.weights],keys:[...profile.keys]}:null;allScores();
  }
  window.EscMulti={applySensitivityWeights,restoreActiveWeights,resetEqualWeights,restoreScenarioAHP,init,condition,exclusionReason,focusTier,scoreOf,isActive,describe,statsByDistrict,renderDiagnostics,renderComparisonMore,renderCuiVariation,mapStyle,tooltip,mapLayerConfig,cuiModal,activeProfile:()=>activeAhp, unique, matchesCondition};
})();
