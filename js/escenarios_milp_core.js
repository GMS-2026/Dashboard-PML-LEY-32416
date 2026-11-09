/* Motor MILP Ley 32416 — modelo matemático auditable.
 * Variables: x_i binarias (seleccionar), c_i continuas (canon compartido),
 * y_g binarias (unidades territoriales únicas del objetivo).
 * Unidades monetarias del optimizador: millones de soles para estabilidad numérica.
 * No se aplica ni calcula una selección heurística dentro de este motor.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ESC_MILP_CORE = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';
  const M = 1e6;
  const HIGH = value => ['ALTO', 'MUY ALTO'].includes(String(value ?? '').trim().toUpperCase());
  const safeNum = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
  function riskMatches(row, filter) {
    const flood = HIGH(row.flood), mass = HIGH(row.mass);
    return filter === 'flood' ? flood : filter === 'mass' ? mass : filter === 'either' ? flood || mass : filter === 'both' ? flood && mass : true;
  }
  function pcmMatches(row, filter) { return filter !== 'declared' || row.pcm === true; }
  function eligibleRows(rows, settings) {
    const coverageMax = settings.coverageEnabled ? Number(settings.coverageMax) : null;
    return rows.filter(r => safeNum(r.deficit) > 0 && pcmMatches(r,settings.pcm) && riskMatches(r, settings.risk) &&
      (!settings.onlyIoarr || !r.canal) &&
      (coverageMax == null || Math.min(100,safeNum(r.canonCoverage)) <= coverageMax+1e-8) &&
      (!settings.excludeCost || !r.costFlag) && (!settings.territory || settings.territory(r)) &&
      (!settings.additional || settings.additional(r)));
  }
  function shortlist(rows, rule) {
    const criteria={pliego_min:['pliego',false],pliego_max:['pliego',true],
      provincia_min:['province',false],provincia_max:['province',true],
      distrito_min:['district',false],distrito_max:['district',true]};
    const conf=criteria[rule];
    if(!conf) return rows.slice();
    const [field,largest]=conf;
    const selected=new Map();
    const ordered=rows.slice().sort((a,b)=>(largest? safeNum(b.deficit)-safeNum(a.deficit) : safeNum(a.deficit)-safeNum(b.deficit)) || String(a.cui).localeCompare(String(b.cui)));
    for(const row of ordered){const key=String(row[field]||'');if(key&&!selected.has(key))selected.set(key,row);}
    return [...selected.values()];
  }
  function build(rows, params, glpk) {
    const gl=glpk||{GLP_MAX:2,GLP_UP:3,GLP_LO:2,GLP_DB:4};
    const filtered=shortlist(eligibleRows(rows,params), params.rule||'todos');
    const budget=Number(params.budget);
    if(!Number.isFinite(budget)||budget<0)throw new Error('Presupuesto no válido');
    if(filtered.length===0)return {empty:true,rows:filtered,model:null};
    const model={name:'PML_LEY32416_MILP',objective:{direction:gl.GLP_MAX,name:'prioridad',vars:[]},
      subjectTo:[],bounds:[],binaries:[],generals:[]};
    const cvars=new Map(),groupVars=new Map(),canonByPliego=new Map();
    const byPliego=new Map(),byRule=new Map(),byGoal=new Map();
    const groupRule=params.rule?.startsWith('pliego_')?'pliego':params.rule?.startsWith('provincia_')?'province':params.rule?.startsWith('distrito_')?'district':null;
    const groupObjective= ['pliegos','provincias','distritos','vulnerables','riesgo','territorial'].includes(params.goal);
    const targetField=params.goal==='pliegos'?'pliego':params.goal==='provincias'?'province':'district';
    const objVars=[];
    for(let i=0;i<filtered.length;i++){
      const r=filtered[i];const x=`x${i}`,d=safeNum(r.deficit)/M,p=String(r.pliego||'');
      model.binaries.push(x);
      if(!byPliego.has(p))byPliego.set(p,[]);byPliego.get(p).push(i);
      if(groupRule){const k=String(r[groupRule]||'');if(k){if(!byRule.has(k))byRule.set(k,[]);byRule.get(k).push(i);}}
      const profit=params.goal==='puentes'?safeNum(r.bridges):params.goal==='emergencia'?Number(r.pcm===true):params.goal==='ahp'?safeNum(r.ahpScore):1;
      if(!groupObjective){objVars.push({name:x,coef:profit});}
      const canonCap=params.useCanon?Math.max(0,safeNum(r.canonMax)/M * safeNum(params.canonPercent)/100):0;
      if(canonCap>0){
        const c=`c${i}`;cvars.set(i,c);
        model.bounds.push({name:c,type:gl.GLP_DB,lb:0,ub:Math.min(d,canonCap)});
        model.subjectTo.push({name:`canon_si_elegida_${i}`,vars:[{name:c,coef:1},{name:x,coef:-d}],bnds:{type:gl.GLP_UP,lb:0,ub:0}});
        if(!canonByPliego.has(p))canonByPliego.set(p,{cap:canonCap,vars:[]});
        const block=canonByPliego.get(p);block.cap=Math.max(block.cap,canonCap);block.vars.push({name:c,coef:1});
      }
      if(groupObjective){
        let qualifies=true;
        if(params.goal==='vulnerables')qualifies=!!r.poor;
        if(params.goal==='riesgo')qualifies=riskMatches(r,'either');
        if(params.goal==='territorial')qualifies=!!r.poor || riskMatches(r,'either');
        if(qualifies){const key=String(r[targetField]||'');if(key){if(!byGoal.has(key))byGoal.set(key,[]);byGoal.get(key).push(i);}}
      }
    }
    // Presupuesto externo B: sum(d_i*x_i-c_i) <= B
    model.subjectTo.push({name:'presupuesto_global',vars:filtered.flatMap((r,i)=>[{name:`x${i}`,coef:safeNum(r.deficit)/M},...(cvars.has(i)?[{name:cvars.get(i),coef:-1}]:[])]),bnds:{type:gl.GLP_UP,lb:0,ub:budget/M}});
    for(const [pliego,block] of canonByPliego.entries())model.subjectTo.push({name:`canon_pliego_${canonByPliego.size}_${model.subjectTo.length}`,vars:block.vars,bnds:{type:gl.GLP_UP,lb:0,ub:block.cap}});
    // Restricciones territoriales explícitas, además del preselector menor/mayor.
    for(const ids of byRule.values()){if(ids.length>1)model.subjectTo.push({name:`territorio_${model.subjectTo.length}`,vars:ids.map(i=>({name:`x${i}`,coef:1})),bnds:{type:gl.GLP_UP,lb:0,ub:1}});}
    if(groupObjective){let j=0;for(const ids of byGoal.values()){
      const y=`y${j++}`;groupVars.set(y,ids);
      model.binaries.push(y);objVars.push({name:y,coef:1});
      model.subjectTo.push({name:`conteo_unico_${j}`,vars:[{name:y,coef:1},...ids.map(i=>({name:`x${i}`,coef:-1}))],bnds:{type:gl.GLP_UP,lb:0,ub:0}});
    }}
    model.objective.vars=objVars;
    if(!objVars.length)return {empty:true,rows:filtered,model:null,reason:'No hay candidatas que aporten al objetivo.'};
    return {empty:false,rows:filtered,model, cvars,groupVars, byPliego};
  }
  function interpret(spec, solverResult, params, glpk){
    if(spec.empty)return {status:'SIN_CANDIDATAS',rows:[],objective:0,optimal:true};
    const status=Number(solverResult?.result?.status??solverResult?.status);
    const opt=status===glpk.GLP_OPT;
    const feas=status===glpk.GLP_FEAS;
    if(!opt&&!feas)return {status:'SIN_SOLUCION',rows:[],optimal:false,solverStatus:status};
    const vars=solverResult.result?.vars||solverResult.vars||{};
    const rows=[];const canonTotals=new Map();
    for(let i=0;i<spec.rows.length;i++){
      if(Number(vars[`x${i}`]||0)<=0.5)continue;
      const r=spec.rows[i];const canon=Math.min(safeNum(r.deficit),Math.max(0,Number(vars[`c${i}`]||0)*M));
      canonTotals.set(r.pliego,(canonTotals.get(r.pliego)||0)+canon);
      rows.push({...r,canonApplied:canon,netDeficit:Math.max(0,r.deficit-canon)});
    }
    const used=rows.reduce((a,r)=>a+r.netDeficit,0);
    if(used>params.budget+0.02)throw new Error(`El resultado excede el presupuesto: ${used} > ${params.budget}`);
    for(const [pliego,amount] of canonTotals){const r=rows.find(r=>r.pliego===pliego);const cap=params.useCanon?safeNum(r.canonMax)*safeNum(params.canonPercent)/100:0;if(amount>cap+0.02)throw new Error(`Canon duplicado en pliego ${pliego}`);}
    return {status:opt?'OPTIMA':'FACTIBLE_NO_ACREDITADA',rows,objective:solverResult.result?.z??solverResult.z,optimal:opt,used,canon:rows.reduce((s,r)=>s+r.canonApplied,0),solverStatus:status};
  }
  return {build, interpret,eligibleRows,shortlist,riskMatches,pcmMatches};
});
