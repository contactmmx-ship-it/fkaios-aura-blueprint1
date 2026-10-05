import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function makeInteractive(html: string) {
  const enhancement = `
<script>
(function () {
  if (window.__fkaiosInteractive) return;
  window.__fkaiosInteractive = true;
  const views = {
    Products: { title: "Products", subtitle: "Manage the product catalogue and current inventory.", body: '<div class="grid gap-4 md:grid-cols-3">'+['Enterprise Suite','Operations Hub','Analytics Pro'].map(function(n,i){return '<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div class="text-xs text-slate-500">PRODUCT '+(i+1)+'</div><div class="mt-2 text-lg font-semibold text-slate-900">'+n+'</div><div class="mt-2 text-sm text-slate-500">Active · Updated today</div><button class="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white" onclick="alert(\'Product details for '+n+' are available in the live product build.\')">View details</button></div>';}).join('')+'</div>' },
    Analytics: { title: "Analytics", subtitle: "Live operational indicators from the product workspace.", body: '<div class="grid gap-4 md:grid-cols-3"><div class="rounded-xl border border-slate-200 bg-white p-5"><div class="text-xs text-slate-500">SUCCESS RATE</div><div class="mt-2 text-3xl font-bold text-slate-900">99.97%</div><div class="mt-2 text-sm text-emerald-600">+2.4% vs last period</div></div><div class="rounded-xl border border-slate-200 bg-white p-5"><div class="text-xs text-slate-500">THROUGHPUT</div><div class="mt-2 text-3xl font-bold text-slate-900">4.1 TB</div><div class="mt-2 text-sm text-slate-500">Processed this period</div></div><div class="rounded-xl border border-slate-200 bg-white p-5"><div class="text-xs text-slate-500">ACTIVE USERS</div><div class="mt-2 text-3xl font-bold text-slate-900">2,874</div><div class="mt-2 text-sm text-emerald-600">+8.1% growth</div></div></div><div class="mt-5 rounded-xl border border-slate-200 bg-white p-5"><h3 class="font-semibold text-slate-900">Activity trend</h3><div class="mt-6 flex h-44 items-end gap-2">'+[38,55,48,72,64,88,76,94,82,100,91,97].map(function(v){return '<div class="flex-1 rounded-t bg-slate-800" style="height:'+v+'%"></div>';}).join('')+'</div></div>' },
    Reports: { title: "Reports", subtitle: "Generated operational reports and verification records.", body: '<div class="overflow-hidden rounded-xl border border-slate-200 bg-white"><table class="w-full text-left text-sm"><thead class="bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-4 py-3">Report</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Updated</th><th class="px-4 py-3"></th></tr></thead><tbody>'+['Executive Summary','Performance Report','Verification Report'].map(function(n){return '<tr class="border-t border-slate-100"><td class="px-4 py-4 font-medium text-slate-900">'+n+'</td><td class="px-4 py-4"><span class="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Ready</span></td><td class="px-4 py-4 text-slate-500">Today</td><td class="px-4 py-4"><button class="text-xs font-medium text-slate-900 underline" onclick="alert(\'Report preview opened: '+n+'\')">Open</button></td></tr>';}).join('')+'</tbody></table></div>' },
    Users: { title: "Users", subtitle: "Current users and access state.", body: '<div class="grid gap-3">'+['Founder / Owner','Operations Lead','Analyst','System Agent'].map(function(n,i){return '<div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4"><div><div class="font-medium text-slate-900">'+n+'</div><div class="text-xs text-slate-500">user-'+(i+1)+'@fkaios.local</div></div><span class="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Active</span></div>';}).join('')+'</div>' },
    Settings: { title: "Settings", subtitle: "Workspace configuration for this generated product.", body: '<div class="space-y-3">'+['Notifications','Data refresh','Access control','Audit logging'].map(function(n){return '<div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4"><div><div class="font-medium text-slate-900">'+n+'</div><div class="text-xs text-slate-500">Configuration is enabled for this demo workspace.</div></div><button class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700" onclick="this.textContent=this.textContent===\'Enabled\'?\'Disabled\':\'Enabled\'">Enabled</button></div>';}).join('')+'</div>' }
  };
  function findMain(){ return document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('.main-content') || document.body; }
  function render(name){
    var main=findMain(), v=views[name]; if(!main||!v)return;
    var wrapper=document.createElement('div'); wrapper.className='fkaios-generated-view';
    wrapper.innerHTML='<div class="mb-6"><h1 class="text-2xl font-bold text-slate-900">'+v.title+'</h1><p class="mt-1 text-sm text-slate-500">'+v.subtitle+'</p></div>'+v.body;
    main.innerHTML=''; main.appendChild(wrapper);
    document.querySelectorAll('[data-fkaios-tab]').forEach(function(el){el.classList.remove('bg-slate-900','text-white');el.classList.add('text-slate-600');});
    var active=document.querySelector('[data-fkaios-tab="'+name+'"]'); if(active){active.classList.add('bg-slate-900','text-white');active.classList.remove('text-slate-600');}
    history.replaceState(null,'','#'+name.toLowerCase());
  }
  function wire(){
    Array.from(document.querySelectorAll('a,button')).filter(function(el){return ['Products','Analytics','Reports','Users','Settings'].indexOf((el.textContent||'').trim())>=0;}).forEach(function(el){
      var name=(el.textContent||'').trim(); if(!views[name]||el.dataset.fkaiosWired)return;
      el.dataset.fkaiosWired='1'; el.dataset.fkaiosTab=name;
      el.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();render(name);});
    });
  }
  wire(); setTimeout(wire,300); setTimeout(wire,1000);
  new MutationObserver(wire).observe(document.body,{childList:true,subtree:true});
})();
</script>`;
  if(html.includes('</body>')) return html.replace('</body>',enhancement+'</body>');
  return html+enhancement;
}

export async function GET(_request: NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  if(!url)return new Response("Product renderer is not configured.",{status:503});
  const endpoint=`${url}/functions/v1/products-public?build_id=${encodeURIComponent(id)}`;
  const response=await fetch(endpoint,{cache:"no-store"});
  const body=await response.text();
  const rendered=response.ok?makeInteractive(body):body;
  return new Response(rendered||"<!doctype html><html><body><p>Product is empty.</p></body></html>",{
    status:response.status,
    headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-FKAIOS-Product-ID":id},
  });
}
