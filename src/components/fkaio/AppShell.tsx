'use client';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Users, Brain, Cpu, Calendar, CalendarDays, FileText,
  Bell, Settings, Menu, X, ChevronRight, Radio, Tag, UserCog,
  UserCircle, Database, GitBranch, TrendingUp, BookOpen, DollarSign,
  ShieldCheck, Sparkles, MessageSquare, Factory, Vault, Scale, Rocket,
  UserCheck, GraduationCap, Zap, Compass, Phone, Hammer, Network, Search, Building2
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
import ProjectReview from '@/components/fkaios/ProjectReview';
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
const fkaioNav = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads-crm', label: 'Leads CRM', icon: Users },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { id: 'project-review', label: 'Project Review', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const brainNav = [
  { id: 'brain-chat', label: 'AI Brain', icon: MessageSquare },
  { id: 'agent-factory', label: 'Agent Factory', icon: Factory },
  { id: 'knowledge-vault', label: 'Knowledge Vault', icon: Vault },
  { id: 'decision-engine', label: 'Decision Engine', icon: Scale },
  { id: 'business-creator', label: 'Business Creator', icon: Rocket },
  { id: 'chief-of-staff', label: 'Chief of Staff', icon: UserCheck },
  { id: 'self-learning', label: 'Self-Learning', icon: GraduationCap },
  { id: 'aura-blueprint', label: 'AURA Blueprint', icon: Compass },
  { id: 'voice-ai', label: 'Voice AI', icon: Phone },
  { id: 'builder-ai', label: 'Builder AI', icon: Hammer },
  { id: 'ai-company', label: 'AI Company', icon: Network },
  { id: 'agent-workday', label: 'Agent Workday', icon: CalendarDays },
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'research', label: 'Research', icon: Search },
];

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
  'executive': 'Executive AI assistant — strategic milestones, founder memory, and business intelligence.',
  'invoices': 'Invoice generation and tracking — create, send, and manage payment collection.',
  'notifications': 'Real-time notifications for lead updates, AI task completions, and system alerts.',
  'profile': 'Your consultant profile — name, role, department, and account settings.',
  'settings': 'System settings — API keys, integrations, branding, and configuration.',
};

export default function AppShell() {
  const [activePage, setActivePage] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

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
    if (activePage === 'dashboard') return <Dashboard />;
    if (activePage === 'settings') return <SettingsPage />;
    if (activePage === 'leads-crm') return <LeadsCRM />;
    if (activePage === 'approvals') return <ApprovalsPage />;
    if (activePage === 'project-review') return <ProjectReview />;
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
    return <PlaceholderPage title={fkaioNav.find(n => n.id === activePage)?.label || 'Dashboard'} description={pageDescriptions[activePage] || 'Not yet built.'} />;
  };

  const currentLabel = [...fkaioNav, ...brainNav].find(n => n.id === activePage)?.label || 'Dashboard';
  const isBrainPage = brainNav.some(n => n.id === activePage);

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
          <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider px-3 mb-2 mt-1">Operations</p>
          <div className="space-y-0.5 mb-4">
            {fkaioNav.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              return (
                <button key={item.id} onClick={() => { setActivePage(item.id); setSidebarOpen(false); }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 w-full text-left cursor-pointer ${
                    active ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30' : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
                  }`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {active && <ChevronRight className="w-3 h-3 ml-auto shrink-0" />}
                </button>
              );
            })}
          </div>

          <p className="text-[9px] font-semibold text-purple-500 uppercase tracking-wider px-3 mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
            AI Brain System
          </p>
          <div className="space-y-0.5 mb-4">
            {brainNav.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              return (
                <button key={item.id} onClick={() => { setActivePage(item.id); setSidebarOpen(false); }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 w-full text-left cursor-pointer ${
                    active ? 'bg-purple-600/20 text-purple-400 border border-purple-600/30' : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
                  }`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {active && <ChevronRight className="w-3 h-3 ml-auto shrink-0" />}
                </button>
              );
            })}
          </div>
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
    </div>
  );
}


