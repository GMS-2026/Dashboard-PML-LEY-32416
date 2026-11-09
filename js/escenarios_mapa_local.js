/* V19 — Cartografía poligonal. Nunca transformar provincias o distritos en puntos.
 * Los límites SVG de departamentos están almacenados localmente. Las capas nacionales
 * GeoJSON se consultan remotamente; el respaldo offline solo contiene 9 provincias y 29
 * distritos de VRAEM, por lo que se declara expresamente su cobertura parcial.
 */
'use strict';
(function(){
 const NS='http://www.w3.org/2000/svg';
 const fixed={minX:-82.1,maxX:-68.2,minY:-18.8,maxY:0.45};
 let regionCache=null;
 const svgScale=640/792,offset=(600-542.76703*svgScale)/2;
 const req=(url,delay=9500)=>{const control=new AbortController(),timer=setTimeout(()=>control.abort(),delay);
  return fetch(url,{signal:control.signal,cache:'force-cache'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).finally(()=>clearTimeout(timer));};
 function note(text,partial=false){let n=document.getElementById('v18MapSourceNote');if(n){n.textContent=text;n.classList.toggle('v19-map-partial',partial);}
  const badge=document.getElementById('v19PolygonStatus');if(badge){badge.hidden=!partial;badge.textContent=partial?'Cobertura cartográfica parcial': '';badge.title=partial?'Solo se dispone de un subconjunto territorial; consulta la cobertura nacional de la capa.':'';badge.classList.toggle('v19-map-partial',partial);}}
 function wire(p,mode,key,label){p.dataset.code=key;
  p.appendChild(Object.assign(document.createElementNS(NS,'title'),{textContent:label}));
  p.addEventListener('pointerenter',e=>showGeoTooltip(e,mode,key,label));p.addEventListener('pointermove',positionGeoTooltip);
  p.addEventListener('pointerleave',()=>{const t=document.getElementById('mapTooltip');if(t)t.hidden=true;});
  p.addEventListener('click',()=>{if(!state.pointerStart?.moved)drillMapTerritory(mode,key);});
 }
 async function regionLayer(){const regions=await (regionCache||(regionCache=req('data/peru_svg_regions.json',10000)));
  const group=document.createElementNS(NS,'g'),paths=new Map(),names=new Map();group.setAttribute('class','esc-layer-enter esc-layer-region');
  for(const r of regions){const p=document.createElementNS(NS,'path');p.setAttribute('d',(r.paths||[]).join(' '));p.setAttribute('transform',`translate(${offset} 0) scale(${svgScale})`);
   p.setAttribute('class','esc-geo-shape');wire(p,'region',r.code,r.name);group.appendChild(p);paths.set(r.code,p);names.set(r.code,r.name);}
  const out={el:group,paths,names,v19Source:'Local — límites regionales SVG'};escLayerCache.set('region',out);
  note('25 departamentos · límites SVG locales del tablero');return out;}
 function featureCode(f,mode){const p=f.properties||{};return String(mode==='province'?(p.code||p.ubigeo_provincia||p.UBIGEO||p.ubigeo||''):(p.code||p.ubigeo_distrito||p.UBIGEO||p.ubigeo||'')).padStart(mode==='province'?4:6,'0');}
 async function polygonLayer(mode){let geo,source,partial=false;
  // Se prefiere una copia local de limites nacionales verificados por el usuario.
  // En el ZIP original no estaba incluida; nunca se completa inventando puntos.
  const official=mode==='province'?'data/limites_provincias_inei.geojson':'data/limites_distritos_inei.geojson';
  const remote=ESC_MAP_URLS[mode];
  try{geo=await req(official,3600);source='Cobertura nacional: GeoJSON local de límites administrativos INEI · ver metadatos del recurso';}
  catch(localError){
   try{geo=await req(remote,9000);source='Cobertura nacional: espejo de límites administrativos · consultar fuente oficial INEI/IDEP';}
   catch(err){partial=true;const src=mode==='province'?'data/territorio-provincias.geojson':'data/territorio-distritos.geojson';
    geo=await req(src,9000);source='SIN CARTOGRAFÍA NACIONAL: respaldo local de '+(mode==='province'?'9 provincias':'29 distritos')+' de VRAEM · no se representan los demás límites';}
  }
  if(!Array.isArray(geo?.features)||!geo.features.length)throw Error('Cartografía vacía');
  const group=document.createElementNS(NS,'g'),paths=new Map(),names=new Map();group.setAttribute('class','esc-layer-enter esc-layer-'+mode);
  const project=geoProjection(fixed),frag=document.createDocumentFragment();
  for(const f of geo.features){const key=featureCode(f,mode);if(!f.geometry||!/^\d{4,6}$/.test(key))continue;
   const path=geometryPath(f.geometry,project);if(!path)continue;
   const p=document.createElementNS(NS,'path');p.setAttribute('d',path);p.setAttribute('class','esc-geo-shape');
   wire(p,mode,key,String(f.properties?.name||f.properties?.provincia||f.properties?.distrito||key));
   frag.appendChild(p);paths.set(key,p);names.set(key,f.properties?.name||f.properties?.provincia||f.properties?.distrito||key);}
  group.appendChild(frag);const out={el:group,paths,names,v19Source:source,v19Partial:partial};escLayerCache.set(mode,out);
  note(source+' · '+paths.size+' polígonos',partial);return out;
 }
 requestMapLayer=async function(mode){if(escLayerCache.has(mode)){const result=escLayerCache.get(mode);note(result.v19Source||'Límites regionales locales',!!result.v19Partial);return result;}
  return mode==='region'?regionLayer():polygonLayer(mode);};
 const prevMarkers=renderRegionalMarkers;
 renderRegionalMarkers=function(){const layer=escLayerCache.get('region');if(state.mapView!=='region'||!layer||!layer.v19Source)return prevMarkers();
  const target=document.getElementById('badgeLayer');target.replaceChildren();
  for(const r of (state.summaryCache.region||[]).slice().sort((a,b)=>b.n-a.n)){
   const path=layer.paths.get(r.key);if(!path)continue;
   try{const box=path.getBBox(),x=offset+(box.x+box.width/2)*svgScale,y=(box.y+box.height/2)*svgScale;
    if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    const group=document.createElementNS(NS,'g');group.setAttribute('class','esc-region-marker esc-marker-improved');group.setAttribute('transform',`translate(${x} ${y})`);
    const circle=document.createElementNS(NS,'circle');circle.setAttribute('r','13');const label=document.createElementNS(NS,'text');label.textContent=r.n;
    group.append(circle,label);group.addEventListener('click',ev=>{ev.stopPropagation();drillMapTerritory('region',r.key);});target.appendChild(group);
   }catch(e){/* Browser SVG geometry not available; polygon stays */}
  }
 };
 const prevFocus=focusMapToScope;
 focusMapToScope=function(){
  if(state.mapView==='region'&&escLayerCache.get('region')?.v19Source){
    const code=state.scopeRegion||state.scopeProvince?.slice(0,2)||state.scopeDistrict?.slice(0,2);
    const shape=code?escLayerCache.get('region').paths.get(code):null;
    if(shape){
      const b=shape.getBBox(),x=offset+b.x*svgScale,y=b.y*svgScale;
      const bw=b.width*svgScale,bh=b.height*svgScale;
      const width=Math.min(600,Math.max(95,bw*1.6,bh*1.6*600/640)),height=width*640/600;
      state.viewport={x:x+bw/2-width/2,y:y+bh/2-height/2,w:width,h:height};
    }else state.viewport={...state.defaultViewport};
    applyViewport();return;
  }
  prevFocus();
 };
 const prevActivate=activateMapView;
 activateMapView=async function(mode){await prevActivate(mode);const cache=escLayerCache.get(mode);if(cache)note(cache.v19Source+(cache.v19Source.startsWith('Cobertura')?' · '+cache.paths.size+' polígonos':''),!!cache.v19Partial);};
})();
