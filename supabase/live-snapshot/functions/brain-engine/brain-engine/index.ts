// brain-engine v40 — Founder Intelligence Layer added.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
async function llmFetch(apiKey, payload) {
  let errMsg = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) return res;
    errMsg = `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  const sys = typeof payload.system === 'string' ? payload.system : '';
  const msgs = Array.isArray(payload.messages) ? payload.messages : [];
  const openaiStyleMessages = [
    ...sys ? [
      {
        role: 'system',
        content: sys
      }
    ] : [],
    ...msgs.map((m)=>({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }))
  ];
  const gKey = Deno.env.get('GEMINI_API_KEY');
  if (gKey) {
    console.log('LLM FALLBACK to gemini-2.5-flash —', errMsg.slice(0, 150));
    const contents = msgs.map((m)=>({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          {
            text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          }
        ]
      }));
    try {
      const gRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: {
          'x-goog-api-key': gKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          ...sys ? {
            systemInstruction: {
              parts: [
                {
                  text: sys
                }
              ]
            }
          } : {},
          contents,
          generationConfig: {
            maxOutputTokens: Number(payload.max_tokens ?? 1024) + 256,
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        })
      });
      if (gRes.ok) {
        const g = await gRes.json();
        const text = (g.candidates?.[0]?.content?.parts ?? []).map((p)=>p.text ?? '').join('');
        return new Response(JSON.stringify({
          model: 'gemini-2.5-flash',
          content: [
            {
              type: 'text',
              text
            }
          ],
          usage: {
            input_tokens: g.usageMetadata?.promptTokenCount ?? 0,
            output_tokens: g.usageMetadata?.candidatesTokenCount ?? 0
          }
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        });
      }
      errMsg = `${errMsg} | Gemini ${gRes.status}: ${(await gRes.text()).slice(0, 200)}`;
    } catch (e) {
      errMsg = `${errMsg} | Gemini: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const compatProviders = [
    {
      name: 'OpenAI',
      envKey: 'open_ai_key',
      url: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini'
    },
    {
      name: 'GLM',
      envKey: 'ZHIPU_API_key',
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: 'glm-4-plus'
    },
    {
      name: 'DeepSeek',
      envKey: 'deepseek key',
      url: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-chat'
    }
  ];
  for (const p of compatProviders){
    const key = Deno.env.get(p.envKey);
    if (!key) continue;
    console.log(`LLM FALLBACK to ${p.model} —`, errMsg.slice(0, 150));
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: p.model,
          max_tokens: payload.max_tokens ?? 1024,
          messages: openaiStyleMessages
        })
      });
      if (res.ok) {
        const d = await res.json();
        const text = d.choices?.[0]?.message?.content ?? '';
        return new Response(JSON.stringify({
          model: p.model,
          content: [
            {
              type: 'text',
              text
            }
          ],
          usage: {
            input_tokens: d.usage?.prompt_tokens ?? 0,
            output_tokens: d.usage?.completion_tokens ?? 0
          }
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        });
      }
      errMsg = `${errMsg} | ${p.name} ${res.status}: ${(await res.text()).slice(0, 200)}`;
    } catch (e) {
      errMsg = `${errMsg} | ${p.name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return new Response(JSON.stringify({
    error: errMsg
  }), {
    status: 502,
    headers: {
      'content-type': 'application/json'
    }
  });
}
async function getFounderPrinciplesBlock(supabase, agentName) {
  try {
    const { data, error } = await supabase.from('founder_principles').select('principle, weight, applies_to').eq('active', true).order('weight', {
      ascending: false
    });
    if (error || !data) return '';
    const relevant = data.filter((p)=>Array.isArray(p.applies_to) && (p.applies_to.includes('*') || p.applies_to.includes(agentName)));
    if (relevant.length === 0) return '';
    return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable — apply these to every response below) ===\n${relevant.map((p)=>`- ${p.principle}`).join('\n')}\n=== END FOUNDER OPERATING PRINCIPLES ===`;
  } catch  {
    return '';
  }
}
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID'
};
function cid() {
  return crypto.randomUUID().slice(0, 8);
}
function log(level, message, data, id) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    correlationId: id || '',
    message,
    ...data ? {
      data
    } : {}
  }));
}
function errRes(message, status, id) {
  log('ERROR', message, undefined, id);
  return new Response(JSON.stringify({
    error: message,
    correlationId: id
  }), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
function okRes(data, id) {
  return new Response(JSON.stringify({
    ...data,
    correlationId: id
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
async function verifyJWT(authHeader, supabaseUrl) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c)=>c.charCodeAt(0))));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return {
      userId: payload.sub
    };
  } catch  {
    return null;
  }
}
async function callClaude(system, messages, maxTokens = 1500) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await llmFetch(apiKey, {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3
      }
    ]
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`All LLM providers failed — ${t.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.content.filter((b)=>b.type === 'text').map((b)=>b.text || '').join('\n');
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: corsHeaders
  });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: req.headers.get('Authorization') || ''
      }
    }
  });
  try {
    const user = await verifyJWT(req.headers.get('Authorization'), supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);
    const body = await req.json();
    if (body.action === 'list') {
      const { data, error } = await supabase.from('brain_conversations').select('*').eq('user_id', user.userId).order('updated_at', {
        ascending: false
      }).limit(50);
      if (error) throw error;
      return okRes({
        conversations: data
      }, id);
    }
    if (body.action === 'create') {
      const { data, error } = await supabase.from('brain_conversations').insert({
        user_id: user.userId,
        title: 'New Session'
      }).select('*').single();
      if (error) throw error;
      log('info', 'Conversation created', {
        conversationId: data.id
      }, id);
      return okRes({
        conversation: data
      }, id);
    }
    if (body.action === 'message') {
      if (!body.conversationId || !body.message) return errRes('conversationId and message are required', 400, id);
      const { data: conv, error: convErr } = await supabase.from('brain_conversations').select('id, user_id').eq('id', body.conversationId).single();
      if (convErr || !conv) return errRes('Conversation not found', 404, id);
      if (conv.user_id !== user.userId) return errRes('Forbidden', 403, id);
      const { error: userMsgErr } = await supabase.from('brain_messages').insert({
        conversation_id: body.conversationId,
        role: 'user',
        content: body.message
      });
      if (userMsgErr) throw userMsgErr;
      const { data: history } = await supabase.from('brain_messages').select('role, content').eq('conversation_id', body.conversationId).order('created_at', {
        ascending: true
      }).limit(20);
      const [brandsRes, docsRes, decisionsRes, ideasRes] = await Promise.all([
        supabase.from('brain_brands').select('name, sector, investment_min, investment_max'),
        supabase.from('brain_knowledge_documents').select('title, content, category').eq('status', 'active').ilike('content', `%${body.message.slice(0, 50)}%`).limit(3),
        supabase.from('brain_decisions').select('title, overall_score, created_at').order('created_at', {
          ascending: false
        }).limit(3),
        supabase.from('brain_business_ideas').select('title, score, status').order('created_at', {
          ascending: false
        }).limit(3)
      ]);
      const brandsCtx = (brandsRes.data || []).map((b)=>`${b.name} (${b.sector || 'general'}, ₹${b.investment_min || '?'}-${b.investment_max || '?'})`).join('; ');
      const docsCtx = (docsRes.data || []).map((d)=>`[${d.category}] ${d.title}: ${(d.content || '').slice(0, 200)}`).join('\n');
      const decisionsCtx = (decisionsRes.data || []).map((d)=>`${d.title} (score: ${d.overall_score})`).join('; ');
      const ideasCtx = (ideasRes.data || []).map((i)=>`${i.title} (score: ${i.score}, ${i.status})`).join('; ');
      const principlesBlock = await getFounderPrinciplesBlock(supabase, 'brain-chat');
      const system = `You are the FK AI Brain — the central AI advisor inside Franchise Kart's FK AIOS, a franchise consulting and multi-brand holding company in India (target: ₹1,100 Crore ecosystem revenue by 2030). You have real, live web search available — use it whenever a question needs current information (competitor moves, market rates, recent news, regulations) rather than relying only on internal data.\n\nCompany brands: ${brandsCtx || 'none seeded yet'}\nRecent decisions scored: ${decisionsCtx || 'none yet'}\nRecent business ideas: ${ideasCtx || 'none yet'}\n${docsCtx ? `\nRelevant knowledge base documents:\n${docsCtx}` : ''}\n\nAnswer as a sharp, concise business advisor. Use real numbers and specifics from the context above and from web search when relevant. If you don't have real data on something, say so plainly rather than inventing figures.${principlesBlock}`;
      const messages = (history || []).map((m)=>({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        }));
      const reply = await callClaude(system, messages);
      const { data: assistantMsg, error: asstErr } = await supabase.from('brain_messages').insert({
        conversation_id: body.conversationId,
        role: 'assistant',
        content: reply
      }).select('*').single();
      if (asstErr) throw asstErr;
      await supabase.from('brain_conversations').update({
        updated_at: new Date().toISOString()
      }).eq('id', body.conversationId);
      log('info', 'Brain chat reply generated', {
        conversationId: body.conversationId
      }, id);
      return okRes({
        message: assistantMsg
      }, id);
    }
    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'brain-engine error', {
      error: msg
    }, id);
    return errRes(msg, 500, id);
  }
});
