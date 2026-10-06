import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reason } from "./founder-brain.ts";
import { classifyObjective, type ObjectiveType } from "./objective-contract.ts";

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

function githubQuery(objective: string, type: ObjectiveType): string {
  const cleaned = objective.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(build|create|make|develop|launch|ship|deliver|fully|functional|premium|responsive|called|named|please|want|need|objective)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const domain = type === "product_creation" ? "website app saas dashboard crm" : type === "software_build" ? "software library framework starter" : "";
  return [cleaned.slice(0,120), domain].filter(Boolean).join(" ").trim();
}

async function discoverGithub(objective: string, type: ObjectiveType) {
  const q=githubQuery(objective,type);
  if(!q) return {query:"", candidates:[], status:"no_query"};
  try {
    const url="https://api.github.com/search/repositories?q="+encodeURIComponent(q)+"&sort=stars&order=desc&per_page=8";
    const res=await fetch(url,{headers:{"Accept":"application/vnd.github+json","User-Agent":"FKAIOS-Discovery/1.0"}});
    if(!res.ok) return {query:q,candidates:[],status:"github_search_error",httpStatus:res.status};
    const body=await res.json();
    const candidates=(Array.isArray(body.items)?body.items:[]).map((r:any)=>({
      full_name:r.full_name, name:r.name, description:r.description, html_url:r.html_url,
      stars:r.stargazers_count, forks:r.forks_count, language:r.language,
      license:r.license?.spdx_id ?? null, updated_at:r.updated_at,
      archived:r.archived === true, open_issues:r.open_issues_count
    })).filter((r:any)=>!r.archived);
    return {query:q,candidates,status:"ok"};
  } catch(e) { return {query:q,candidates:[],status:"github_search_failed",error:e instanceof Error?e.message:String(e)}; }
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

export async function prepareObjectiveContract(objective:{id:string;raw_request:string;department_code:string|null;status:string}, correlationId?:string) {
  const type=classifyObjective(objective.raw_request);
  const [github,existing,capabilities]=await Promise.all([
    discoverGithub(objective.raw_request,type),
    discoverExisting(objective.raw_request),
    discoverCapabilities(type,objective.raw_request)
  ]);

  const context={objective:objective.raw_request,objectiveType:type,existingWork:existing,githubCandidates:github.candidates.slice(0,8),capabilities:capabilities.slice(0,12)};
  const response=await reason(
    "You are the FKAIOS Solution Architect. Convert the founder objective into a precise execution contract. Preserve the founder's intent; do not invent facts. Reuse existing work before new work. If a repository/capability is only a partial match, explicitly describe what must be adapted. Translate vague quality language such as premium or enterprise into measurable acceptance criteria. Return ONLY JSON.",
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
      github_query:github.query,
      github_status:github.status,
      github_candidates:github.candidates.slice(0,8),
      existing_work:existing,
      capabilities:capabilities.slice(0,12)
    },
    solution_plan:ai.solution_plan ?? {strategy:"reuse_adapt_compose_build"},
    continuity:{
      existing_work_found:(existing.project_matches?.length??0)+(existing.build_matches?.length??0)>0,
      preserve_existing_alignment:true
    },
    status:"ready"
  };
  const db=client();
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
