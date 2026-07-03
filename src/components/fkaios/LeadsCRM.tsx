'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Users, Phone, MessageSquare, Loader2, ChevronRight, RefreshCw, Building2 } from 'lucide-react';

interface Lead {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  lead_source: string | null;
  stage: string;
  lead_score: number | null;
  notes: string | null;
  created_at: string;
}

interface InboundMessage {
  id: string;
  message_text: string;
  reply_text: string | null;
  replied: boolean;
  created_at: string;
}

const STAGES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'closed', 'lost'];

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  contacted: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  qualified: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  proposal_sent: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  negotiation: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  closed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  lost: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

export default function LeadsCRM() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [stageUpdating, setStageUpdating] = useState(false);
  const [filterStage, setFilterStage] = useState<string>('all');

  useEffect(() => { loadLeads(); }, []);

  async function loadLeads() {
    setLoading(true);
    const { data } = await supabase
      .from('leads')
      .select('id, company_name, contact_name, contact_phone, lead_source, stage, lead_score, notes, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    setLeads(data || []);
    setLoading(false);
  }

  async function selectLead(lead: Lead) {
    setSelected(lead);
    setMessagesLoading(true);
    const { data } = await supabase
      .from('whatsapp_inbound_messages')
      .select('id, message_text, reply_text, replied, created_at')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: true });
    setMessages(data || []);
    setMessagesLoading(false);
  }

  async function updateStage(newStage: string) {
    if (!selected) return;
    setStageUpdating(true);
    const { error } = await supabase.from('leads').update({ stage: newStage }).eq('id', selected.id);
    if (!error) {
      setSelected({ ...selected, stage: newStage });
      setLeads((prev) => prev.map((l) => (l.id === selected.id ? { ...l, stage: newStage } : l)));
    }
    setStageUpdating(false);
  }

  const filteredLeads = filterStage === 'all' ? leads : leads.filter((l) => l.stage === filterStage);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-blue-400" />
          <div>
            <h2 className="text-lg font-semibold">Leads CRM</h2>
            <p className="text-xs text-slate-500 mt-0.5">Real leads from WhatsApp and other sources — no demo data.</p>
          </div>
        </div>
        <button onClick={loadLeads} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Stage filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterStage('all')}
          className={`px-3 py-1 rounded-full text-xs font-medium border ${filterStage === 'all' ? 'bg-slate-700 text-white border-slate-600' : 'bg-slate-900 text-slate-500 border-slate-800'}`}
        >
          All ({leads.length})
        </button>
        {STAGES.map((s) => {
          const count = leads.filter((l) => l.stage === s).length;
          if (count === 0) return null;
          return (
            <button
              key={s}
              onClick={() => setFilterStage(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border capitalize ${filterStage === s ? STAGE_COLORS[s] : 'bg-slate-900 text-slate-500 border-slate-800'}`}
            >
              {s.replace('_', ' ')} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Lead list */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-4">
              <Users className="w-8 h-8 text-slate-700 mb-2" />
              <p className="text-sm text-slate-500">No leads yet.</p>
              <p className="text-xs text-slate-600 mt-1">Real leads will appear here the moment someone messages your WhatsApp number.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800 max-h-[70vh] overflow-y-auto">
              {filteredLeads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => selectLead(lead)}
                  className={`w-full text-left p-4 hover:bg-slate-800/50 transition-all flex items-center justify-between ${selected?.id === lead.id ? 'bg-slate-800/70' : ''}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{lead.contact_name || lead.company_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {lead.contact_phone && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Phone className="w-3 h-3" /> {lead.contact_phone}
                        </span>
                      )}
                      {lead.lead_source && <span className="text-xs text-slate-600">· {lead.lead_source}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${STAGE_COLORS[lead.stage] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                      {lead.stage.replace('_', ' ')}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-5">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <MessageSquare className="w-8 h-8 text-slate-700 mb-2" />
              <p className="text-sm text-slate-500">Select a lead to view their conversation and details.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold">{selected.contact_name || selected.company_name}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    {selected.contact_phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{selected.contact_phone}</span>}
                    <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{selected.company_name}</span>
                  </div>
                </div>
                <select
                  value={selected.stage}
                  onChange={(e) => updateStage(e.target.value)}
                  disabled={stageUpdating}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white capitalize disabled:opacity-50"
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>

              {selected.lead_source === 'WhatsApp' && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Conversation</p>
                  {messagesLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 text-slate-500 animate-spin" /></div>
                  ) : messages.length === 0 ? (
                    <p className="text-xs text-slate-600">No messages recorded yet.</p>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                      {messages.map((m) => (
                        <div key={m.id} className="space-y-1.5">
                          <div className="flex justify-start">
                            <div className="max-w-[85%] bg-slate-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-slate-200">
                              {m.message_text}
                            </div>
                          </div>
                          {m.reply_text ? (
                            <div className="flex justify-end">
                              <div className="max-w-[85%] bg-blue-600 rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-white">
                                {m.reply_text}
                              </div>
                            </div>
                          ) : (
                            <div className="flex justify-end">
                              <span className="text-[10px] text-amber-500">AI reply pending…</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {selected.notes && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-xs text-slate-500 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}

              <p className="text-[10px] text-slate-600">Lead created {new Date(selected.created_at).toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
