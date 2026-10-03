import { NextRequest, NextResponse } from 'next/server';
import { FKAIOS_PROVIDER_CATALOG, chooseResource, verifyResourceDecision, createResourceGateway, type ResourceTask, type ResourceAdapter } from '@/lib/resource-intelligence';

export const runtime = 'nodejs';

type Message = { role: 'user' | 'assistant' | 'system'; content: string };

function env(name: string) { return process.env[name]?.trim(); }

function adapters(): ResourceAdapter[] {
  const result: ResourceAdapter[] = [];
  if (env('OPENAI_API_KEY')) result.push({ providerId: 'openai', execute: async (input) => callOpenAI(input) });
  if (env('ANTHROPIC_API_KEY')) result.push({ providerId: 'anthropic', execute: async (input) => callAnthropic(input) });
  if (env('GROQ_API_KEY')) result.push({ providerId: 'groq', execute: async (input) => callOpenAICompatible(input, 'https://api.groq.com/openai/v1/chat/completions', env('GROQ_API_KEY')!, 'llama-3.3-70b-versatile') });
  return result;
}

async function callOpenAI(input: unknown) {
  return callOpenAICompatible(input, env('OPENAI_BASE_URL') || 'https://api.openai.com/v1/chat/completions', env('OPENAI_API_KEY')!, env('OPENAI_MODEL') || 'gpt-4.1-mini');
}

async function callOpenAICompatible(input: any, url: string, key: string, model: string) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: input.messages, temperature: 0.2 }) });
  if (!r.ok) throw new Error(`provider_http_${r.status}`);
  const j = await r.json();
  return { text: j.choices?.[0]?.message?.content ?? '', provider: input.provider };
}

async function callAnthropic(input: any) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env('ANTHROPIC_API_KEY')!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: env('ANTHROPIC_MODEL') || 'claude-3-5-sonnet-latest', max_tokens: 1600, system: input.system, messages: input.messages.filter((m: Message) => m.role !== 'system') }) });
  if (!r.ok) throw new Error(`provider_http_${r.status}`);
  const j = await r.json();
  return { text: j.content?.map((x: any) => x.text || '').join('') ?? '', provider: 'anthropic' };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: Message[] = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return NextResponse.json({ error: 'messages_required' }, { status: 400 });

    const task: ResourceTask = { id: `brain_${Date.now()}`, capability: 'reasoning', importance: 'normal', quality: body.quality === 'frontier' ? 'frontier' : 'balanced', allowPaid: true, allowCredit: true, preferredProviders: body.preferredProviders };
    const configured = FKAIOS_PROVIDER_CATALOG.map(p => {
      const adapter = adapters().find(a => a.providerId === p.id);
      return adapter ? { ...p, enabled: true } : { ...p, enabled: false };
    });
    const decision = chooseResource(task, configured);
    if (!decision) return NextResponse.json({ error: 'no_ai_provider_configured', detail: 'Configure OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY.' }, { status: 503 });
    const verification = verifyResourceDecision(task, decision, configured);
    if (verification.status !== 'verified') return NextResponse.json({ error: 'resource_verification_failed', detail: verification }, { status: 503 });

    const gateway = createResourceGateway(adapters());
    const input = { messages, system: body.system || 'You are FKAIOS, an AI operating system. Be factual, operational, and never invent business data. If data is unavailable, say so.', provider: decision.providerId };
    const result = await gateway.execute(task, decision, input);
    return NextResponse.json({ ...result, decision: { providerId: decision.providerId, reason: decision.reason, estimatedCostUsd: decision.estimatedCostUsd } });
  } catch (error) {
    return NextResponse.json({ error: 'brain_execution_failed', detail: error instanceof Error ? error.message : 'unknown_error' }, { status: 502 });
  }
}
