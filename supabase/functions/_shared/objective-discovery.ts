import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reason } from "./founder-brain.ts";
import { classifyObjective, type ObjectiveType } from "./objective-contract.ts";
import { brandsIn, classifyMemoryHits, dropPausedBrands, githubQueries as reuseGithubQueries, isOwnRepo, OWN_GITHUB_OWNER, ownRepoQueries, rankRadar, reuseOrder, reuseOrderLine, reuseSummary, searchTerms, type MemoryHit, type RadarCandidate } from "./reuse-first.ts";

function client() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

function extractObject(raw: string): Record<string, unknown> {
  const text = raw.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
  try { const parsed = JSON.parse(text); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>; } catch {}
  const s=text.indexOf("{"), e=text.lastIndexOf("}");
  if(s>=0 && e>s){ try { const parsed=JSON.parse(text.slice(s,e+1)); if(parsed && typeof parsed==="object" && !Array.isArray(parsed)) return parsed as Record<string,unknown>; } catch {} }
  return {};
}

function githubQueries(objective: string, type: ObjectiveType): string[] {
  const cleaned = objective.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(build|create|make|develop|launch|ship|deliver|fully|functional|premium|responsive|called|named|please|want|need|objective)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter((w:string)=>w.length>=4);
  const domain = type === "product_creation"
    ? ["website app saas dashboard crm","starter template ui ux","open source platform"]
    : type === "software_build"
    ? ["software library framework starter","open source implementation","production ready template"]
    : ["open source implementation","automation tool integration"];
  const base = cleaned.slice(0,120);
  return [...new Set(domain.map(d=>[base,d].filter(Boolean).join(" ").trim()).concat(
    words.length>3 ? [words.slice(0,5).join(" ")] : []
  ))].filter(Boolean).slice(0,4);
}

async function discoverGithub(objective: string, type: ObjectiveType, explicitQueries?: string[], useToken = false) {
  // 4 Nov 2026: keyword queries from reuse-first.ts (the raw-sentence queries below found nothing in run 6).
  const queries=explicitQueries && explicitQueries.length ? explicitQueries : githubQueries(objective,type);
  if(!queries.length) return {query:"",candidates:[],status:"no_query"};
  try {
    const results=await Promise.all(queries.map(async(q)=>{
      const url="https://api.github.com/search/repositories?q="+encodeURIComponent(q)+"&sort=stars&order=desc&per_page=10";
      const token=useToken ? Deno.env.get("GITHUB_TOKEN") : undefined;
      const res=await fetch(url,{headers:{"Accept":"application/vnd.github+json","User-Agent":"FKAIOS-Discovery/1.0",...(token?{"Authorization":"Bearer "+token}:{})}});
      if(!res.ok) return {q,items:[],status:"error",httpStatus:res.status};
      const body=await res.json();
      return {q,items:Array.isArray(body.items)?body.items:[],status:"ok"};
    }));
    const byRepo=new Map<string,any>();
    for(const result of results) for(const r of result.items) {
      if(r.archived===true) continue;
      const existing=byRepo.get(r.full_name);
      const record={
        full_name:r.full_name,name:r.name,description:r.description,html_url:r.html_url,
        stars:r.stargazers_count,forks:r.forks_count,language:r.language,
        license:r.license?.spdx_id ?? null,updated_at:r.updated_at,archived:r.archived===true,
        open_issues:r.open_issues_count,
        matched_queries:[...(existing?.matched_queries??[]),result.q]
      };
      byRepo.set(r.full_name,record);
    }
    const candidates=[...byRepo.values()].sort((a,b)=>{
      const activityA=new Date(a.updated_at||0).getTime(), activityB=new Date(b.updated_at||0).getTime();
      const scoreA=Number(a.stars||0)+Number(a.forks||0)*3+(a.matched_queries?.length||0)*5000+(activityA>0&&Date.now()-activityA<365*86400000?3000:0);
      const scoreB=Number(b.stars||0)+Number(b.forks||0)*3+(b.matched_queries?.length||0)*5000+(activityB>0&&Date.now()-activityB<365*86400000?3000:0);
      return scoreB-scoreA;
    }).slice(0,20);
    return {queries,candidates,status:results.every(r=>r.status==="ok")?"ok":"partial"};
  } catch(e) { return {queries,candidates:[],status:"github_search_failed",error:e instanceof Error?e.message:String(e)}; }
}

async function discoverExisting(objective: string) {
  const db=client();
  const tokens=objective.toLowerCase().split(/[^a-z0-9]+/).filter((x:string)=>x.length>=5).slice(0,8);
  const {data: projects}=await db.from("orchestration_projects")
    .select("id,request,status,output_type,created_at,final_output")
    .order("created_at",{ascending:false}).limit(30);
  const matches=(projects??[]).filter((p:any)=>{
    const text=String(p.request??"").toLowerCase();
    return tokens.some((t:string)=>text.includes(t));
  }).slice(0,8);
  const {data: builds}=await db.from("build_projects")
    .select("id,brand_name,build_type,status,deployed_url,created_at")
    .order("created_at",{ascending:false}).limit(30);
  const buildMatches=(builds??[]).filter((b:any)=>{
    const text=(String(b.brand_name??"")+" "+String(b.build_type??"")).toLowerCase();
    return tokens.some((t:string)=>text.includes(t));
  }).slice(0,8);
  return {project_matches:matches,build_matches:buildMatches};
}

async function discoverCapabilities(type: ObjectiveType, objective: string) {
  const db=client();
  const {data}=await db.from("capability_registry")
    .select("name,kind,provider,purpose,capabilities,operations,auth_state,cost_state,availability,limitations,license,health,handoff_support,priority,source,metadata")
    .order("priority",{ascending:true}).limit(100);
  const words=objective.toLowerCase().split(/[^a-z0-9]+/).filter((x:string)=>x.length>=4);
  const scored=(data??[]).map((c:any)=>{
    const hay=(String(c.name)+" "+String(c.purpose)+" "+String(c.provider)+" "+JSON.stringify(c.capabilities??[])+" "+JSON.stringify(c.operations??[])).toLowerCase();
    const score=words.reduce((n:number,w:string)=>n+(hay.includes(w)?1:0),0);
    return {...c,match_score:score};
  }).filter((c:any)=>c.match_score>0 || ["product_creation","software_build"].includes(type) && /build|github|web|app|deploy/i.test(String(c.purpose)));
  scored.sort((a:any,b:any)=>Number(b.match_score)-Number(a.match_score)||Number(a.priority??999)-Number(b.priority??999));
  return scored.slice(0,12);
}

function scoreCapability(c:any, objective:string, type:ObjectiveType) {
  const text=(String(c.name)+" "+String(c.purpose)+" "+String(c.provider)+" "+JSON.stringify(c.capabilities??[])+" "+JSON.stringify(c.operations??[])).toLowerCase();
  const words=objective.toLowerCase().split(/[^a-z0-9]+/).filter((x:string)=>x.length>=4);
  const fit=Math.min(100, words.reduce((n:number,w:string)=>n+(text.includes(w)?8:0),0));
  const availability=/available|configured/i.test(String(c.availability)) ? 100 : /unknown/i.test(String(c.availability)) ? 40 : 0;
  const auth=/configured|not_required/i.test(String(c.auth_state)) ? 100 : 0;
  const cost=/free|paid_active/i.test(String(c.cost_state)) ? 80 : /quota_limited/i.test(String(c.cost_state)) ? 45 : 20;
  const continuity=c.handoff_support ? 100 : 45;
  const risk=(/unavailable|missing|exhausted|429|insufficient/i.test(String(c.limitations)) ? 60 : 0);
  const quality=Math.min(100, fit + (c.priority ? Math.max(0,50-Math.min(50,Number(c.priority))) : 0));
  const score=Math.round(fit*0.30+quality*0.20+availability*0.18+auth*0.12+cost*0.08+continuity*0.07+(100-risk)*0.05);
  return {score,fit_score:fit,quality_score:quality,availability_score:availability,cost_score:cost,continuity_score:continuity,risk_score:risk};
}


// 4 Nov 2026 — REUSE FIRST: brand names known to FKAIOS (brands table + memory source brands).
async function pausedBrands(): Promise<string[]> {
  const {data}=await client().from("brands").select("name,status,is_active").limit(200);
  return (data??[]).filter((r:any)=>r.status==="paused"||r.status==="archived"||r.is_active===false).map((r:any)=>String(r.name??"").trim()).filter((n:string)=>n.length>=3);
}

async function knownBrands(): Promise<string[]> {
  const db=client();
  const [{data:b},{data:s}]=await Promise.all([
    db.from("brands").select("name").limit(200),
    db.from("fkaios_knowledge_sources").select("brand").not("brand","is",null).limit(1000),
  ]);
  const names=[...(b??[]).map((r:any)=>String(r.name??"")),...(s??[]).map((r:any)=>String(r.brand??""))].map((n)=>n.trim()).filter((n)=>n.length>=3);
  return [...new Set(names)];
}

// Past work in founder memory for ANY brand. Brand comes from the source row, else from its title.
async function discoverMemory(terms:string[], brands:string[], objectiveBrands:string[]) {
  if(!terms.length) return [];
  const db=client();
  const {data,error}=await db.rpc("fkaios_memory_search",{p_terms:terms,p_limit:12});
  if(error||!Array.isArray(data)) return [];
  const bySource=new Map<string,{title:string;score:number}>();
  for(const r of data as any[]){ const id=String(r.source_id); const prev=bySource.get(id); const score=Number(r.matched_fraction??0); if(!prev||score>prev.score) bySource.set(id,{title:String(r.title??""),score}); }
  const ids=[...bySource.keys()];
  const {data:src}=ids.length?await db.from("fkaios_knowledge_sources").select("id,brand").in("id",ids):{data:[]};
  const brandOf=new Map((src??[]).map((r:any)=>[String(r.id),r.brand?String(r.brand):null]));
  const hits:MemoryHit[]=ids.map((id)=>{ const v=bySource.get(id)!; return {source_id:id,title:v.title,brand:brandOf.get(id)??brandsIn(v.title,brands)[0]??null,score:v.score}; });
  const paused=await pausedBrands().catch(()=>[] as string[]);
  return classifyMemoryHits(dropPausedBrands(hits,paused,objectiveBrands).sort((a,b)=>b.score-a.score).slice(0,8),objectiveBrands);
}

// Tools the World Radar has already found.
async function discoverRadar(terms:string[]) {
  if(!terms.length) return [];
  const db=client();
  const ors=terms.slice(0,4).flatMap((t)=>[`name.ilike.%${t.replace(/[%,()]/g,"")}%`,`description.ilike.%${t.replace(/[%,()]/g,"")}%`]).join(",");
  const {data}=await db.from("fkaios_ecosystem_candidates").select("name,url,kind,license,description").or(ors).limit(200);
  return rankRadar((data??[]) as RadarCandidate[],terms,10);
}

export async function prepareObjectiveContract(objective:{id:string;raw_request:string;department_code:string|null;status:string}, correlationId?:string) {
  const type=classifyObjective(objective.raw_request);
  // 4 Nov 2026 — REUSE FIRST: own past work (any brand; other brands = method only) → Radar + GitHub → capabilities.
  const brands=await knownBrands().catch(()=>[] as string[]);
  const objectiveBrands=brandsIn(objective.raw_request,brands);
  const terms=searchTerms(objective.raw_request,brands);
  // 5 Nov 2026 — founder's order: own repos → open-source repos → free tools → previous work → build new.
  const owner=Deno.env.get("FKAIOS_GITHUB_OWNER") || OWN_GITHUB_OWNER;
  const ownQueries=ownRepoQueries(terms,owner);
  const [ownRepos,githubRaw,existing,capabilities,memoryReuse,radar]=await Promise.all([
    ownQueries.length ? discoverGithub(objective.raw_request,type,ownQueries,true) : Promise.resolve({queries:[],candidates:[],status:"no_query"} as any),
    discoverGithub(objective.raw_request,type,reuseGithubQueries(terms,type)),
    discoverExisting(objective.raw_request),
    discoverCapabilities(type,objective.raw_request),
    discoverMemory(terms,brands,objectiveBrands).catch(()=>[]),
    discoverRadar(terms).catch(()=>[])
  ]);
  const ownCandidates=(ownRepos.candidates??[]).filter((r:any)=>isOwnRepo(r.full_name,owner));
  const github={...githubRaw,candidates:(githubRaw.candidates??[]).filter((r:any)=>!isOwnRepo(r.full_name,owner))};
  const freeTools=[...capabilities.filter((c:any)=>/free|included|no_cost/i.test(String(c.cost_state??""))).map((c:any)=>({name:String(c.name)})),...radar.map((r:any)=>({name:String(r.name)}))];
  const order=reuseOrder({ownRepos:ownCandidates,openSourceRepos:github.candidates,freeTools,previousWork:memoryReuse});
  const reuseLine=reuseOrderLine(order)+" "+reuseSummary(memoryReuse,radar,github.candidates??[]);

  const scoredCapabilities=capabilities.map((c:any)=>({...c,...scoreCapability(c,objective.raw_request,type)})).sort((a:any,b:any)=>b.score-a.score);
  const githubOptions=github.candidates.map((r:any,i:number)=>({
    ...r,
    score:Math.min(100,Math.round(40+Math.min(40,Number(r.stars||0)/5000)+Math.min(15,Number(r.forks||0)/500))),
    fit_score:0, quality_score:Math.min(100,Math.round(Math.min(100,Number(r.stars||0)/100))), continuity_score:0,
    availability_score:100, cost_score:100, risk_score:r.license ? 0 : 25
  }));
  const context={objective:objective.raw_request,objectiveType:type,reuseFirst:{summary:reuseLine,order,ownRepos:ownCandidates.slice(0,10),rule:"FOUNDER ORDER: use the founder's own repositories first, then open-source repositories, then free AI tools, then previous FKAIOS work; build new only for what none of these covers, and say which step each part of the plan comes from. Reuse past work first. data_and_method: same brand, figures may be used with citation. method_only: another brand — reuse structure and approach, never its figures. check_brand: brand not recorded — use its figures only if the text itself shows they belong to this brand.",searchTerms:terms,objectiveBrands,pastWork:memoryReuse,radarTools:radar},existingWork:existing,githubQueries:github.queries ?? [],githubCandidates:githubOptions.slice(0,20),capabilities:scoredCapabilities.slice(0,12)};
  const response=await reason(
    "You are the FKAIOS Solution Architect. Convert the founder objective into a precise execution contract. Preserve the founder's intent; do not invent facts. Follow the founder's reuse order in reuseFirst.order: own repositories, then open-source repositories, then free AI tools, then previous FKAIOS work, and build new only for the gap. If a repository/capability is only a partial match, explicitly describe what must be adapted. Translate vague quality language such as premium or enterprise into measurable acceptance criteria. Return ONLY JSON.",
    JSON.stringify(context),
    1400,
    correlationId
  );
  const ai=extractObject(response.text);
  const contract={
    objectiveType:type,
    intent:ai.intent ?? {goal:objective.raw_request},
    requirements:Array.isArray(ai.requirements)?ai.requirements:[],
    acceptance_criteria:Array.isArray(ai.acceptance_criteria)?ai.acceptance_criteria:[],
    quality_benchmark:ai.quality_benchmark ?? {},
    discovery:{
      github_queries:github.queries ?? [],
      github_status:github.status,
      github_candidates:github.candidates.slice(0,20),
      existing_work:existing,
      capabilities:scoredCapabilities.slice(0,12),
      reuse_first:{summary:reuseLine,order,own_repos:ownCandidates.slice(0,10),own_repo_status:ownRepos.status,search_terms:terms,objective_brands:objectiveBrands,past_work:memoryReuse,radar_tools:radar}
    },
    solution_plan:ai.solution_plan ?? {strategy:"reuse_adapt_compose_build"},
    continuity:{
      existing_work_found:(existing.project_matches?.length??0)+(existing.build_matches?.length??0)>0,
      preserve_existing_alignment:true
    },
    status:"ready"
  };
  const db=client();
  const options=[
    ...scoredCapabilities.map((c:any)=>({objective_id:objective.id,source_type:"capability",source_id:String(c.name),name:String(c.name),score:c.score,fit_score:c.fit_score,quality_score:c.quality_score,continuity_score:c.continuity_score,availability_score:c.availability_score,cost_score:c.cost_score,risk_score:c.risk_score,recommendation:c.score>=70?"preferred":c.score>=45?"candidate":"fallback",evidence:{provider:c.provider,purpose:c.purpose,limitations:c.limitations,auth_state:c.auth_state,cost_state:c.cost_state,availability:c.availability}})),
    ...ownCandidates.map((r:any,i:number)=>({objective_id:objective.id,source_type:"github_repo",source_id:String(r.full_name),name:String(r.full_name),rank:i+1,score:90,fit_score:0,quality_score:0,continuity_score:100,availability_score:100,cost_score:100,risk_score:0,recommendation:i===0?"preferred":"candidate",evidence:{...r,own_repo:true,reuse_step:1}})),
    ...githubOptions.map((r:any,i:number)=>({objective_id:objective.id,source_type:"github_repo",source_id:String(r.full_name),name:String(r.full_name),rank:i+1,score:r.score,fit_score:r.fit_score,quality_score:r.quality_score,continuity_score:r.continuity_score,availability_score:r.availability_score,cost_score:r.cost_score,risk_score:r.risk_score,recommendation:i===0?"candidate":"alternative",evidence:r}))
  ];
  await db.from("objective_solution_options").delete().eq("objective_id",objective.id);
  if(options.length) {
    const {error:optionsError}=await db.from("objective_solution_options").insert(options);
    if(optionsError) throw new Error("solution option persistence failed: "+optionsError.message);
  }
  const {error}=await db.from("objective_contracts").upsert({
    objective_id:objective.id,
    objective_type:type,
    intent:contract.intent,
    requirements:contract.requirements,
    acceptance_criteria:contract.acceptance_criteria,
    quality_benchmark:contract.quality_benchmark,
    discovery:contract.discovery,
    solution_plan:contract.solution_plan,
    continuity:contract.continuity,
    status:"ready",
    updated_at:new Date().toISOString()
  },{onConflict:"objective_id"});
  if(error) throw new Error("objective contract persistence failed: "+error.message);
  return contract;
}
