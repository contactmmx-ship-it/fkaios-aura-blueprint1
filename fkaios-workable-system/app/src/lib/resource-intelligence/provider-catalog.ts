import type { Capability, ResourceProvider } from './types';

export const FKAIOS_PROVIDER_CATALOG: ResourceProvider[] = [
  { id: 'openai', name: 'OpenAI', kind: 'model', enabled: true, priority: 10, capabilities: ['reasoning','coding','vision','embeddings','speech','general'], costMode: 'paid', metadata: { adapter: 'openai' } },
  { id: 'anthropic', name: 'Anthropic', kind: 'model', enabled: true, priority: 10, capabilities: ['reasoning','coding','vision','general'], costMode: 'paid', metadata: { adapter: 'anthropic' } },
  { id: 'google-gemini', name: 'Google Gemini', kind: 'model', enabled: true, priority: 9, capabilities: ['reasoning','coding','vision','embeddings','general'], costMode: 'paid', metadata: { adapter: 'google-gemini' } },
  { id: 'groq', name: 'Groq', kind: 'model', enabled: true, priority: 8, capabilities: ['reasoning','coding','general'], costMode: 'paid', metadata: { adapter: 'groq' } },
  { id: 'cloudflare', name: 'Cloudflare', kind: 'cloud', enabled: true, priority: 7, capabilities: ['general','browser'], costMode: 'paid', metadata: { adapter: 'cloudflare' } },
  { id: 'aws', name: 'AWS', kind: 'cloud', enabled: true, priority: 7, capabilities: ['general','browser'], costMode: 'paid', metadata: { adapter: 'aws' } },
  { id: 'azure', name: 'Microsoft Azure', kind: 'cloud', enabled: true, priority: 7, capabilities: ['general','browser'], costMode: 'paid', metadata: { adapter: 'azure' } },
  { id: 'vercel', name: 'Vercel', kind: 'tool', enabled: true, priority: 8, capabilities: ['general'], costMode: 'paid', metadata: { adapter: 'vercel' } },
  { id: 'supabase', name: 'Supabase', kind: 'tool', enabled: true, priority: 8, capabilities: ['general'], costMode: 'paid', metadata: { adapter: 'supabase' } },
  { id: 'github', name: 'GitHub', kind: 'tool', enabled: true, priority: 8, capabilities: ['coding','general'], costMode: 'free', metadata: { adapter: 'github' } },
  { id: 'apify', name: 'Apify', kind: 'tool', enabled: true, priority: 8, capabilities: ['search','browser','general'], costMode: 'credit', metadata: { adapter: 'apify' } },
];

export function providersFor(capability: Capability): ResourceProvider[] {
  return FKAIOS_PROVIDER_CATALOG.filter(p => p.capabilities.includes(capability));
}
