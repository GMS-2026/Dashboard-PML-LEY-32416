'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const groups={
  'Identificación':[['cui','CUI'],['REGION','Región'],['provincia','Provincia'],['distrito','Distrito'],['ubigeo_distrito','UBIGEO intervención'],['UBIGEO UE','UBIGEO UE'],['pliego','Pliego'],['DENOMINACION DE LA INVERSION','Denominación'],['ES IOARR','Es IOARR']],
  'Costos y finanzas':[['costo_actualizado','Costo actualizado (S/)'],['pim','PIM 2026 (S/)'],['devengado_acumulado','Devengado acumulado 2025 (S/)'],['PIA 2027','PIA 2027 (S/)'],['deficit','Déficit calculado (S/)'],['deficit_financiable','Brecha financiable (S/)'],['CERTIFICACION','Certificación (S/)'],['COMPROMISO ANUAL','Compromiso anual (S/)'],['DEVENGADO','Devengado 2026 (S/)'],['CANON','Canon referencial del pliego (S/)']],
  'Estado y convenios':[['etapa','Etapa de inversión'],['estado_situacional','Estado situacional'],['detalle_estado','Detalle del estado'],['dependencia','Dependencia'],['estado_convenio','Situación del convenio'],['etapa_convenio','Etapa convenio'],['numero_convenio','N.° convenio'],['oficio_notificacion','Oficio de notificación'],['paquete','Paquete']],
  'Puente y ubicación':[['n_puentes','N.° puentes'],['longitud','Longitud de puentes (m)'],['este_utm','UTM Este'],['norte_utm','UTM Norte'],['latitud','Latitud'],['LONGITUD.1','Longitud geográfica'],['registrado_spml','Registrado SPML']],
  'Contexto y territorio':[['DECLARATORIA DE EMERGENCIA PCM','Declaratoria PCM'],['RANKING POBREZA','Ranking de pobreza'],['QUINTIL POBREZA','Quintil de pobreza'],['AREA AGRICOLA','Superficie agrícola (ha)']]
 };
 const allCols=Object.values(groups).flat();const names=new Map(allCols);
 let data=[];let visible=[];let chosen=new Set(groups.Identificación.slice(0,8).map(x=>x[0]).concat(groups['Costos y finanzas'].slice(0,6).map(x=>x[0])));
 const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const fmt=n=>Number(n||0).toLocaleString('es-PE',{maximumFractionDigits:0});
 const money=n=>`S/ ${Number(n||0).toLocaleString('es-PE',{maximumFractionDigits:2})}`;
 const raw=key=>data.map(r=>r[key]).filter(x=>x!=null);
 function fillOptions(id, options, placeholder){const sel=$(id),prev=sel.value;sel.replaceChildren(new Option(placeholder,''));for(const [key,label] of options)sel.add(new Option(label,key));if([...sel.options].some(x=>x.value===prev))sel.value=prev;}
 function territories(){
  const dept=$('dlDept').value,prov=$('dlProv').value;
  fillOptions('dlProv',[...new Map(data.filter(r=>!dept||r.ubigeo_departamento===dept).map(r=>[r.ubigeo_provincia,`${r.provincia}`])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'es')),'Todas las provincias');
  if(prov&&$ ('dlProv').value!==prov)$('dlProv').value='';
  const p=$('dlProv').value;
  fillOptions('dlDist',[...new Map(data.filter(r=>(!dept||r.ubigeo_departamento===dept)&&(!p||r.ubigeo_provincia===p)).map(r=>[r.ubigeo_distrito,r.distrito])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'es')),'Todos los distritos');
 }
 function filter(){const dept=$('dlDept').value,prov=$('dlProv').value,dist=$('dlDist').value,search=norm($('dlSearch').value.trim());
  visible=data.filter(r=>(!dept||r.ubigeo_departamento===dept)&&(!prov||r.ubigeo_provincia===prov)&&(!dist||r.ubigeo_distrito===dist)&&(!search||norm([r.cui,r.pliego,r['DENOMINACION DE LA INVERSION'],r.distrito,r.provincia].join(' ')).includes(search)));
  $('dlFiltered').textContent=fmt(visible.length);$('dlGap').textContent=money(visible.reduce((s,r)=>s+Math.max(0,Number(r.deficit)||0),0));
  $('dlTerritorySummary').textContent=[data.find(r=>r.ubigeo_departamento===dept)?.REGION,data.find(r=>r.ubigeo_provincia===prov)?.provincia,data.find(r=>r.ubigeo_distrito===dist)?.distrito].filter(Boolean).join(' · ')||'Perú · Todo el territorio';
  $('dlCountColumns').textContent=fmt(chosen.size);$('dlColumnsBadge').textContent=`${chosen.size} columnas`;
  $('dlExport').disabled=!visible.length||!chosen.size;
  preview();
 }
 function selected(){return allCols.filter(([key])=>chosen.has(key));}
 function preview(){const cols=selected();$('dlPreview').tHead.innerHTML=`<tr>${cols.map(c=>`<th>${esc(c[1])}</th>`).join('')}</tr>`;
 $('dlPreview').tBodies[0].innerHTML=visible.slice(0,15).map(r=>`<tr>${cols.map(([key])=>`<td>${esc(r[key]??'—')}</td>`).join('')}</tr>`).join('')||'<tr><td>No hay inversiones con esta selección</td></tr>';
 }
 function groupsUI(){ $('dlGroups').innerHTML=Object.entries(groups).map(([key,cols])=>{const n=cols.filter(x=>chosen.has(x[0])).length;
   return `<button class="dl-group v19-group-tile ${n===cols.length?'is-complete':n?'is-partial':''}" type="button" data-group="${esc(key)}" aria-pressed="${n===cols.length}"><i class="bi ${key==='Identificación'?'bi-fingerprint':key==='Costos y finanzas'?'bi-cash-stack':key==='Estado y convenios'?'bi-file-earmark-text':key==='Puente y ubicación'?'bi-geo-alt':'bi-map'}"></i><span><b>${esc(key)}</b><small>${n} de ${cols.length} campos seleccionados</small><span class="v19-mini-progress"><i style="width:${n/cols.length*100}%"></i></span></span><em>${n===cols.length?'Seleccionado':n?'Personalizado':'Añadir grupo'}</em></button>`;}).join('');
   $('dlColumnList').innerHTML=allCols.map(([key,label])=>`<label><input type="checkbox" data-col="${esc(key)}" ${chosen.has(key)?'checked':''}><span>${esc(label)}</span></label>`).join('');
 }
 document.getElementById('dlGroups').addEventListener('click',e=>{const button=e.target.closest('[data-group]');if(!button)return;const key=button.dataset.group;if(!groups[key])return;const all=groups[key].every(([col])=>chosen.has(col));for(const [col] of groups[key]){if(all)chosen.delete(col);else chosen.add(col);}groupsUI();filter();});
 document.addEventListener('change',e=>{if(e.target.closest('#dlColumnList')){const key=e.target.dataset.col;if(key){e.target.checked?chosen.add(key):chosen.delete(key);groupsUI();filter();}}
  else if(e.target.id==='dlDept'){ $('dlProv').value='';$('dlDist').value='';territories();filter();}
  else if(e.target.id==='dlProv'){ $('dlDist').value='';territories();filter();}
  else if(e.target.id==='dlDist')filter();});
 $('dlSearch').addEventListener('input',filter);
 $('dlClear').addEventListener('click',()=>{$('dlDept').value='';$('dlProv').value='';$('dlDist').value='';$('dlSearch').value='';territories();filter();});
 $('dlExport').addEventListener('click',()=>{if(!visible.length||!chosen.size)return;const cols=selected();window.ESCExcel.downloadCustom({title:'Cartera de inversiones · Ley N.° 32416',headers:cols.map(c=>c[1]),rows:visible.map(r=>cols.map(c=>r[c[0]]??'')),filename:`Inversiones_Ley32416_${new Date().toISOString().slice(0,10)}.xlsx`});});
 fetch('data/puentes.json',{cache:'no-store'}).then(res=>{if(!res.ok)throw new Error(`HTTP ${res.status}`);return res.json();}).then(rows=>{
 data=rows;fillOptions('dlDept',[...new Map(data.map(r=>[r.ubigeo_departamento,r.REGION])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'es')),'Todos los departamentos');territories();groupsUI();$('dlTotal').textContent=fmt(data.length);filter();$('dlStatus').innerHTML='<i class="bi bi-check-circle"></i> Listo para consultar y descargar · Los datos se mantienen locales al navegador.';
 }).catch(err=>{$('dlStatus').textContent='No se pudo leer la cartera: '+err.message;});
})();
