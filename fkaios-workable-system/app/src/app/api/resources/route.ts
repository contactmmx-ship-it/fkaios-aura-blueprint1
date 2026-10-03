import { NextResponse } from 'next/server';
import { FKAIOS_PROVIDER_CATALOG } from '@/lib/resource-intelligence';
export const runtime = 'nodejs';
export async function GET() {
  const configured = new Set(['OPENAI_API_KEY','ANTHROPIC_API_KEY','GROQ_API_KEY'].filter(k => process.env[k]));
  return NextResponse.json({ providers: FKAIOS_PROVIDER_CATALOG.map(p => ({ id:p.id,name:p.name,kind:p.kind,capabilities:p.capabilities,costMode:p.costMode,configured: (p.id==='openai'&&configured.has('OPENAI_API_KEY')) || (p.id==='anthropic'&&configured.has('ANTHROPIC_API_KEY')) || (p.id==='groq'&&configured.has('GROQ_API_KEY')) })) });
}
