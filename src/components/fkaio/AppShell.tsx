'use client';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Users, Brain, Cpu, Calendar, CalendarDays, FileText,
  Bell, Settings, Menu, X, ChevronRight, Radio, Tag, UserCog,
  UserCircle, Database, GitBranch, TrendingUp, BookOpen, DollarSign,
  ShieldCheck, Sparkles, MessageSquare, Factory, Vault, Scale, Rocket,
  UserCheck, GraduationCap, Zap, Compass, Phone, Hammer, Network, Search, Building2, IndianRupee
} from 'lucide-react';
import BrainChat from '@/components/fkaios/BrainChat';
import AgentFactory from '@/components/fkaios/AgentFactory';
import KnowledgeVault from '@/components/fkaios/KnowledgeVault';
import DecisionEngine from '@/components/fkaios/DecisionEngine';
import BusinessCreator from '@/components/fkaios/BusinessCreator';
import ChiefOfStaff from '@/components/fkaios/ChiefOfStaff';
import SelfLearning from '@/components/fkaios/SelfLearning';
import AuraBlueprint from '@/components/fkaios/AuraBlueprint';
import AgentWorkday from '@/components/fkaios/AgentWorkday';
import CompaniesAdmin from '@/components/fkaios/CompaniesAdmin';
import LoginPage from './LoginPage';
import Dashboard from '@/components/fkaios/Dashboard';
import VoiceAI from '@/components/fkaios/VoiceAI';
import BuilderAI from '@/components/fkaios/BuilderAI';
import OrchestratorAI from '@/components/fkaios/OrchestratorAI';
import SettingsPage from '@/components/fkaios/SettingsPage';
import LeadsCRM from '@/components/fkaios/LeadsCRM';
import ResearchOS from '@/components/fkaios/ResearchOS';
import ApprovalsPage from '@/components/fkaios/ApprovalsPage';
import GovernanceDashboard from '@/components/fkaios/GovernanceDashboard';
import RevenueDesk from '@/components/fkaios/RevenueDesk';
import ProjectReview from '@/components/fkaios/ProjectReview';
import MyBrain from '@/components/fkaios/MyBrain';
import ProductVideoGenerator from '@/components/fkaios/ProductVideoGenerator';
import FounderAvatar from '@/components/fkaios/FounderAvatar';
import { supabase } from '@/lib/supabase';

// ---- Navigation definition matching original FKAIO + Brain pages ----
// NOTE: This list previously had 20 items; 17 were non-functional
// placeholders (Leads CRM, Command Centre, Brand Management, Team, AI
// Agents, AI Jobs, Agent Memory, Workflows, AI Evolution, Meetings,
// Calendar, Knowledge Base, Accounting, Approvals, Executive AI, Invoices,
// Notifications, Profile) that rendered generic "connected to Supabase"
// text with no actual data or function behind them. Per the no-placeholder
// rule, they are removed from the sidebar rather than left visible and
// non-functional. Each can be added back individually once it is genuinely
// built and wired to real data — see AEOS_STATUS.md for the honest roadmap.
// UPDATE (Founder Vision Audit Phase 3/6): Approvals is back — wired for
// real this time to finance-engine + company_invoices + founder_notifications.
// ---- FIVE-DOOR INFORMATION ARCHITECTURE (World-Class OS Blueprint §11) ----
// 23 flat items -> 5 doors. NOTHING deleted: every page keeps its id and
// component; it is reparented into the door where it logically lives.
// TODAY is a direct door (the landing). The other four are collapsible groups.
type NavItem = { id: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavDoor = { door: string; icon: React.ComponentType<{ className?: string }>; accent: string; items: NavItem[] };

const NAV_DOORS: NavDoor[] = [
  {
    door: 'TODAY', icon: Scale, accent: 'text-cyan-400',
    items: [
      { id: 'governance', label: 'Today — Command Center', icon: Scale },
      { id: 'founder-avatar', label: 'Founder Avatar', icon: Radio },
    ],
  },
  {
    door: 'BUSINESS', icon: DollarSign, accent: 'text-emerald-400',
    items: [
      { id: 'revenue-desk', label: 'Revenue Desk', icon: IndianRupee },
      { id: 'leads-crm', label: 'Leads & Pipeline', icon: Users },
      { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
      { id: 'dashboard', label: 'Operations Dashboard', icon: LayoutDashboard },
      { id: 'companies', label: 'Companies', icon: Building2 },
    ],
  },
  {
    door: 'WORKFORCE', icon: Cpu, accent: 'text-blue-400',
    items: [
      { id: 'agent-workday', label: 'Agent Workday', icon: CalendarDays },
      { id: 'agent-factory', label: 'Agent Factory', icon: Factory },
      { id: 'chief-of-staff', label: 'Chief of Staff', icon: UserCheck },
      { id: 'ai-company', label: 'AI Company', icon: Network },
    ],
  },
  {
    door: 'INTELLIGENCE', icon: Brain, accent: 'text-purple-400',
    items: [
      { id: 'my-brain', label: 'My Brain', icon: ShieldCheck },
      { id: 'brain-chat', label: 'AI Brain Chat', icon: MessageSquare },
      { id: 'knowledge-vault', label: 'Knowledge Vault', icon: Vault },
      { id: 'research', label: 'Research', icon: Search },
      { id: 'decision-engine', label: 'Decision Engine', icon: Scale },
      { id: 'self-learning', label: 'Self-Learning', icon: GraduationCap },
    ],
  },
  {
    door: 'BUILD', icon: Hammer, accent: 'text-amber-400',
    items: [
      { id: 'builder-ai', label: 'Builder AI', icon: Hammer },
      { id: 'business-creator', label: 'Business Creator', icon: Rocket },
      { id: 'product-video', label: 'Product Video Gen', icon: Users },
      { id: 'project-review', label: 'Project Review', icon: FileText },
      { id: 'aura-blueprint', label: 'AURA Blueprint', icon: Compass },
      { id: 'voice-ai', label: 'Voice AI', icon: Phone },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];
// Flat index for ⌘K and label lookups.
const ALL_PAGES: NavItem[] = NAV_DOORS.flatMap(d => d.items);

// ---- Placeholder pages for original FKAIO modules ----
function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-96 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
        <Zap className="w-7 h-7 text-slate-500" />
      </div>
      <div className="text-center">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <p className="text-sm text-slate-400 mt-2 max-w-md">{description}</p>
      </div>
      <div className="mt-2 px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700">
        <p className="text-xs text-slate-500">Connected to Supabase — data loads from your live database</p>
      </div>
    </div>
  );
}

const pageDescriptions: Record<string, string> = {
  'dashboard': 'Overview of leads, revenue, AI agents, and system health across all brands.',
  'leads': 'Full CRM pipeline with lead scoring, objection handling, negotiation tracking, and stage management.',
  'command-centre': 'Central operations hub for managing franchise activities, real-time monitoring, and quick actions.',
  'brands': 'Manage your 6 brand portfolio — investment ranges, royalty structures, sector classification, and brand docs.',
  'team': 'Team management with role-based access control, consultant profiles, and performance tracking.',
  'ai-agents': 'AI agent fleet management — monitor active agents, task completion rates, and success metrics.',
  'ai-jobs': 'AI job queue — view pending, running, completed, and failed AI tasks with retry capabilities.',
  'agent-memory': 'Persistent memory store for AI agents — context, learning, preferences, and conversation history.',
  'workflows': 'Workflow automation engine — create and manage trigger-based workflows for your AI agents.',
  'ai-evolution': 'Track how your AI agents evolve over time with metrics comparison and improvement tracking.',
  'meetings': 'Schedule and track meetings with leads — status, notes, and follow-up reminders.',
  'calendar': 'Calendar view of all meetings, follow-ups, deadlines, and brand events.',
  'knowledge': 'Knowledge base management — upload, parse, chunk, and embed documents for AI retrieval.',
  'accounting': 'Financial management — transactions, bank statements, revenue snapshots, and reconciliation.',
  'approvals': 'Governance approval queue — review and approve/refuse AI actions, payments, and contracts.',
  'governance': 'Founder Governance Dashboard — constitution health, governed decisions, agent trust, KPIs, executive intelligence, audit and violations. All live data.',
  'executive': 'Executive AI assistant — strategic milestones, founder memory, and business intelligence.',
  'invoices': 'Invoice generation and tracking — create, send, and manage payment collection.',
  'notifications': 'Real-time notifications for lead updates, AI task completions, and system alerts.',
  'profile': 'Your consultant profile — name, role, department, and account settings.',
  'settings': 'System settings — API keys, integrations, branding, and configuration.',
};

export default function AppShell() {
  // Land directly in the Chairman's Command Center on login — the Founder
  // enters the enterprise headquarters immediately (Founder Avatar remains
  // one click away in the nav).
  const [activePage, setActivePage] = useState('governance');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  // Five-door IA: doors collapse; the door containing the active page opens.
  const [openDoors, setOpenDoors] = useState<Record<string, boolean>>({ TODAY: true });
  // ⌘K command palette (Blueprint §11 / Bloomberg command-language principle).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); setPaletteQuery(''); }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (id: string) => {
    setActivePage(id);
    setSidebarOpen(false);
    setPaletteOpen(false);
    const door = NAV_DOORS.find(d => d.items.some(i => i.id === id));
    if (door) setOpenDoors(prev => ({ ...prev, [door.door]: true }));
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) setUserEmail(data.session.user.email);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email || '');
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUserEmail('');
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <span className="text-slate-500 text-sm">Loading...</span>
      </div>
    );
  }

  if (!userEmail) {
    return <LoginPage onLoggedIn={() => { /* onAuthStateChange listener updates userEmail automatically */ }} />;
  }

  const renderPage = () => {
    if (activePage === 'founder-avatar') return <FounderAvatar />;
    if (activePage === 'dashboard') return <Dashboard />;
    if (activePage === 'settings') return <SettingsPage />;
    if (activePage === 'leads-crm') return <LeadsCRM />;
    if (activePage === 'approvals') return <ApprovalsPage />;
    if (activePage === 'governance') return <GovernanceDashboard />;
    if (activePage === 'revenue-desk') return <RevenueDesk />;
    if (activePage === 'project-review') return <ProjectReview />;
    if (activePage === 'my-brain') return <MyBrain />;
    if (activePage === 'product-video') return <ProductVideoGenerator />;
    switch (activePage) {
      case 'brain-chat': return <BrainChat />;
      case 'agent-factory': return <AgentFactory />;
      case 'knowledge-vault': return <KnowledgeVault />;
      case 'decision-engine': return <DecisionEngine />;
      case 'business-creator': return <BusinessCreator />;
      case 'chief-of-staff': return <ChiefOfStaff />;
      case 'self-learning': return <SelfLearning />;
      case 'aura-blueprint': return <AuraBlueprint />;
      case 'voice-ai': return <VoiceAI />;
      case 'builder-ai': return <BuilderAI />;
      case 'ai-company': return <OrchestratorAI />;
      case 'agent-workday': return <AgentWorkday />;
      case 'companies': return <CompaniesAdmin />;
      case 'research': return <ResearchOS />;
    }
    return <PlaceholderPage title={ALL_PAGES.find(n => n.id === activePage)?.label || 'Dashboard'} description={pageDescriptions[activePage] || 'Not yet built.'} />;
  };

  const currentLabel = ALL_PAGES.find(n => n.id === activePage)?.label || 'Dashboard';
  const isBrainPage = ['INTELLIGENCE','WORKFORCE'].includes(NAV_DOORS.find(d => d.items.some(i => i.id === activePage))?.door || '');

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed lg:static lg:translate-x-0 z-50 w-64 h-full bg-slate-900 border-r border-slate-800 transition-transform duration-300 flex flex-col`}>
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-tight">Franchisee Kart</h1>
              <p className="text-[10px] text-cyan-400 font-semibold uppercase tracking-wider">AIOS</p>
            </div>
          </div>
          <button className="lg:hidden text-slate-400 hover:text-white cursor-pointer" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 overflow-y-auto">
          {/* ⌘K entry point */}
          <button onClick={() => { setPaletteOpen(true); setPaletteQuery(''); }}
            className="w-full flex items-center gap-2 px-3 py-2 mb-3 mt-1 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-400 hover:text-white text-xs cursor-pointer">
            <Search className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">Jump anywhere…</span>
            <kbd className="text-[9px] bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5">⌘K</kbd>
          </button>

          {/* FIVE DOORS — 23 pages reparented, nothing deleted (Blueprint §11) */}
          {NAV_DOORS.map((d) => {
            const DoorIcon = d.icon;
            const containsActive = d.items.some(i => i.id === activePage);
            const open = openDoors[d.door] || containsActive;
            return (
              <div key={d.door} className="mb-1.5">
                <button onClick={() => setOpenDoors(prev => ({ ...prev, [d.door]: !open }))}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left cursor-pointer transition-colors ${containsActive ? 'bg-slate-800/70' : 'hover:bg-slate-800/40'}`}>
                  <DoorIcon className={`w-4 h-4 shrink-0 ${d.accent}`} />
                  <span className={`text-[11px] font-bold tracking-wider ${containsActive ? 'text-white' : 'text-slate-300'}`}>{d.door}</span>
                  <ChevronRight className={`w-3 h-3 ml-auto shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
                {open && (
                  <div className="mt-0.5 ml-3 pl-3 border-l border-slate-800 space-y-0.5">
                    {d.items.map((item) => {
                      const Icon = item.icon;
                      const active = activePage === item.id;
                      return (
                        <button key={item.id} onClick={() => go(item.id)}
                          className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all w-full text-left cursor-pointer ${
                            active ? 'bg-blue-600/20 text-blue-300 border border-blue-600/30' : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
                          }`}>
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-xs font-bold">
              {userEmail?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{userEmail || 'Loading...'}</p>
              <p className="text-xs text-slate-500">Founder</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="w-full text-xs text-slate-500 hover:text-slate-300 text-left cursor-pointer">
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 bg-slate-900/50 border-b border-slate-800 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <button className="lg:hidden text-slate-400 hover:text-white cursor-pointer" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-lg font-semibold">{currentLabel}</h2>
              {isBrainPage && <p className="text-[10px] text-purple-400 font-medium">FKAIOS Virtual Brain Operating System</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isBrainPage && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                <span className="text-[10px] text-purple-400 font-medium">Brain Active</span>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>

      {/* ⌘K COMMAND PALETTE — jump to any of the 23 pages by name */}
      {paletteOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[18vh] bg-black/60 backdrop-blur-sm" onClick={() => setPaletteOpen(false)}>
          <div className="w-full max-w-lg mx-4 rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
              <Search className="w-4 h-4 text-slate-500" />
              <input autoFocus value={paletteQuery} onChange={e => setPaletteQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const q = paletteQuery.trim().toLowerCase();
                    const hit = ALL_PAGES.find(p => p.label.toLowerCase().includes(q)) || ALL_PAGES[0];
                    if (hit) go(hit.id);
                  }
                }}
                placeholder="Type a page name… (Enter to jump, Esc to close)"
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none" />
              <kbd className="text-[9px] text-slate-500 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5">esc</kbd>
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {ALL_PAGES.filter(p => !paletteQuery.trim() || p.label.toLowerCase().includes(paletteQuery.trim().toLowerCase())).map(p => {
                const door = NAV_DOORS.find(d => d.items.some(i => i.id === p.id));
                const Icon = p.icon;
                return (
                  <button key={p.id} onClick={() => go(p.id)}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-slate-800/70 cursor-pointer">
                    <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="text-sm text-slate-200 flex-1 truncate">{p.label}</span>
                    <span className="text-[9px] text-slate-600 uppercase tracking-wider">{door?.door}</span>
                  </button>
                );
              })}
              {ALL_PAGES.filter(p => p.label.toLowerCase().includes(paletteQuery.trim().toLowerCase())).length === 0 && (
                <p className="px-4 py-3 text-xs text-slate-500">No page matches “{paletteQuery}”.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


