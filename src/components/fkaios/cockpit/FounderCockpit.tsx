'use client';
import { useEffect, useState } from 'react';
import { Brain, Cpu, ShieldCheck, Gavel } from 'lucide-react';
import CockpitBackground from './CockpitBackground';
import CockpitPanel from './CockpitPanel';
import { CockpitLabel } from './CockpitPrimitives';
import IntelligenceOrb from './IntelligenceOrb';
import { supabase } from '@/lib/supabase';
import LoginPage from '@/components/fkaio/LoginPage';
import WorkforcePanel, { WorkforceMember } from '../WorkforcePanel';
import DecisionCenter from '../DecisionCenter';

// FounderCockpit — Phase 3 shell, refined in Phase 4B for visual polish only
// (bigger/richer orb, mission line, tighter hero spacing, per-panel icons for
// hierarchy). Still no data fetching, no Supabase calls, no AI/voice state —
// every panel deliberately shows "Awaiting intelligence connection" because
// real data wiring is a later, separate phase. Not mounted into
// AppShell/routing yet — this component exists standalone until that phase
// is approved.
//
// Phase 5: Founder Intelligence Layer connection. The "AI CEO Briefing"
// panel, the Intelligence Growth Strip, the orb caption, and the
// "Intelligence" status chip are now wired to real data (executive_cycles,
// incl. observed_state.founder_decision_profile, plus fleet_memory). AI
// Workforce / Governance Health / Founder Approval Queue stay as placeholders
// — out of scope for this pass by design. Two direct client-side Supabase
// reads, no backend/edge-function/schema changes, gated by a new auth check
// (same getSession()/LoginPage pattern AppShell.tsx already uses) and by
// executive_cycles' existing RLS policy (founder role only).

interface FounderDecisionProfile {
  readiness: string;
  history: { rulingsRecorded: number; totalDecisions: number };
}

interface ExecutiveCycleRow {
  cycle_number: number;
  situation_assessment: string | null;
  founder_briefing: string | null;
  model_used: string | null;
  created_at: string;
  observed_state: { founder_decision_profile?: FounderDecisionProfile } | null;
}

interface MemoryEntry {
  memory_type: string;
  created_at: string;
}

function rel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function FounderGreetingBar() {
  // Client-only clock — avoids SSR/client hydration mismatch by rendering
  // nothing until mounted, then ticking a real system clock (no business data).
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const hour = now?.getHours() ?? null;
  const greeting = hour === null ? '' : hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div>
      <h1
        className="text-white"
        style={{
          fontSize: 'var(--cockpit-founder-heading-size)',
          fontWeight: 'var(--cockpit-founder-heading-weight)',
          letterSpacing: 'var(--cockpit-founder-heading-tracking)',
        }}
      >
        {greeting ? `${greeting}, Rajeev` : 'Founder Cockpit'}
      </h1>
      <p className="mt-1 text-sm text-slate-400">Bhavishya Associates AI Command Center</p>
      <p className="mt-2 max-w-sm text-xs italic leading-relaxed text-slate-500">
        Your AI operating system for decisions, execution and growth.
      </p>
      <p className="mt-1 text-xs text-slate-600 tabular-nums">
        {now ? now.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'medium' }) : ' '}
      </p>
    </div>
  );
}

type StatusState = 'Ready' | 'Awaiting Data';

const STATUS_ITEMS: { label: string; state: StatusState }[] = [
  { label: 'Constitution', state: 'Awaiting Data' },
  { label: 'Governance', state: 'Awaiting Data' },
  { label: 'Intelligence', state: 'Awaiting Data' },
  { label: 'System Health', state: 'Awaiting Data' },
];

function StatusRail({ readiness }: { readiness: Record<string, boolean> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch lg:gap-2">
      {STATUS_ITEMS.map((item) => {
        // Real per-item override where data is connected; otherwise the
        // existing honest "Awaiting Data" placeholder.
        const state = readiness[item.label] ? 'Ready' : item.state;
        return (
          <div
            key={item.label}
            className="flex items-center gap-2 rounded-full border px-3 py-1.5 lg:rounded-xl lg:justify-between"
            style={{ background: 'var(--cockpit-command-panel-bg)', borderColor: 'var(--cockpit-glass-border)' }}
          >
            <span className="flex items-center gap-2">
              <span
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${state === 'Ready' ? 'bg-emerald-400' : 'bg-slate-500'}`}
                style={{ animationDuration: 'var(--cockpit-pulse-speed)' }}
              />
              <span className="text-xs text-slate-300 whitespace-nowrap">{item.label}</span>
            </span>
            <span className="text-[10px] text-slate-500 whitespace-nowrap ml-2 lg:ml-0">{state}</span>
          </div>
        );
      })}
    </div>
  );
}

function AwaitingConnection({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 py-8 text-center">
      <Icon className="w-6 h-6 text-slate-700" />
      <span
        className="w-2 h-2 rounded-full animate-pulse"
        style={{ background: 'var(--cockpit-glow-cyan)', animationDuration: 'var(--cockpit-pulse-speed)' }}
      />
      <p className="text-xs text-slate-500">Awaiting intelligence connection</p>
    </div>
  );
}

function BriefingPanelBody({
  loading,
  error,
  cycle,
  founderDecisionProfile,
}: {
  loading: boolean;
  error: string | null;
  cycle: ExecutiveCycleRow | null;
  founderDecisionProfile: FounderDecisionProfile | null;
}) {
  if (loading) return <AwaitingConnection icon={Brain} />;

  if (error) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 py-8 text-center">
        <Brain className="w-6 h-6 text-slate-700" />
        <p className="text-xs text-red-400/80">Could not load intelligence data</p>
      </div>
    );
  }

  if (!cycle) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 py-8 text-center">
        <Brain className="w-6 h-6 text-slate-700" />
        <p className="text-xs text-slate-500">No executive cycle has run yet — this activates after the first daily cycle.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[160px] space-y-2">
      <p className="text-[10px] text-slate-500">
        Cycle {cycle.cycle_number} &middot; {rel(cycle.created_at)} &middot; {cycle.model_used ?? 'model unknown'}
      </p>
      <p className="line-clamp-3 text-xs leading-relaxed text-slate-300">
        {cycle.situation_assessment || 'No situation assessment recorded.'}
      </p>
      {cycle.founder_briefing && (
        <p className="line-clamp-2 text-xs leading-relaxed text-cyan-300/80">{cycle.founder_briefing}</p>
      )}
      {founderDecisionProfile && (
        <p className="mt-2 border-t border-white/5 pt-2 text-[11px] text-slate-500">
          Founder Decision Intelligence: <span className="text-slate-400">{founderDecisionProfile.readiness}</span>
        </p>
      )}
    </div>
  );
}

function GovernanceHealthBody({
  loading,
  error,
  violations,
  approvalQueue,
  constitutionActive,
  constitutionTotal,
  noGoCount,
}: {
  loading: boolean;
  error: string | null;
  violations: number | null;
  approvalQueue: number | null;
  constitutionActive: number | null;
  constitutionTotal: number | null;
  noGoCount: number | null;
}) {
  if (loading) return <AwaitingConnection icon={ShieldCheck} />;

  if (error) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 py-8 text-center">
        <ShieldCheck className="w-6 h-6 text-slate-700" />
        <p className="text-xs text-red-400/80">Could not load governance data</p>
      </div>
    );
  }

  return (
    <div className="min-h-[160px] space-y-2">
      <p className="text-xs text-slate-300">
        <span className={violations !== null && violations > 0 ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold'}>
          {violations ?? '—'}
        </span>{' '}
        constitution violation{violations === 1 ? '' : 's'} on record
      </p>
      <p className="text-xs text-slate-300">
        <span className="text-amber-300 font-semibold">{approvalQueue ?? '—'}</span> item(s) in the approval queue
      </p>
      <p className="text-xs text-slate-400">
        {constitutionActive !== null && constitutionTotal !== null
          ? `Constitution: ${constitutionActive}/${constitutionTotal} laws active`
          : 'Constitution: awaiting data'}
      </p>
      <p className="mt-2 border-t border-white/5 pt-2 text-[11px] text-slate-500">
        {noGoCount !== null && noGoCount > 0
          ? `${noGoCount} department(s) reporting NO-GO or unstaffed`
          : 'All departments reporting nominal (no NO-GO/unstaffed signals)'}
      </p>
    </div>
  );
}

function IntelligenceGrowthStrip({
  memoryEntries,
  rulingsRecorded,
  totalDecisions,
  loading,
}: {
  memoryEntries: MemoryEntry[];
  rulingsRecorded: number | null;
  totalDecisions: number | null;
  loading: boolean;
}) {
  const hasAny = memoryEntries.length > 0;

  // Real per-day counts for the last 5 days (including today) — a bucket
  // count of the fleet_memory rows already fetched, no fabricated shape.
  const dayCounts = [4, 3, 2, 1, 0].map((offset) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return memoryEntries.filter((m) => {
      const t = new Date(m.created_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;
  });
  const maxCount = Math.max(1, ...dayCounts);

  return (
    <CockpitPanel title="Intelligence Growth Layer" subtitle="MEMORY & EVIDENCE OVER TIME">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 h-px" style={{ background: 'var(--cockpit-glass-border)' }}>
          {dayCounts.map((count, i) => {
            const size = hasAny ? 6 + (count / maxCount) * 6 : 6;
            return (
              <span
                key={i}
                className="absolute top-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${(i / 4) * 100}%`,
                  width: size,
                  height: size,
                  background: hasAny && count > 0 ? 'var(--cockpit-glow-cyan)' : 'var(--cockpit-glass-border)',
                  opacity: hasAny && count > 0 ? 0.5 + (count / maxCount) * 0.5 : 1,
                }}
              />
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {loading
          ? 'Loading intelligence growth data…'
          : !hasAny
            ? 'Awaiting historical intelligence data — no fabricated timeline shown.'
            : `${memoryEntries.length} memory entr${memoryEntries.length === 1 ? 'y' : 'ies'} recorded — last 5 days shown.`}
      </p>
      {!loading && rulingsRecorded !== null && (
        <p className="mt-1 text-xs text-slate-600">
          Founder decision evidence: {rulingsRecorded} of 5 rulings recorded
          {totalDecisions !== null && totalDecisions !== rulingsRecorded ? ` (${totalDecisions} total decision records)` : ''}.
        </p>
      )}
    </CockpitPanel>
  );
}

export default function FounderCockpit() {
  // Auth gate — identical pattern to AppShell.tsx (same getSession() +
  // onAuthStateChange listener, same LoginPage component). This route now
  // shows real founder/business intelligence, so it needs the same login
  // this app already requires everywhere else.
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

  const [cycle, setCycle] = useState<ExecutiveCycleRow | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [govViolations, setGovViolations] = useState<number | null>(null);
  const [govApprovalQueue, setGovApprovalQueue] = useState<number | null>(null);
  const [constitutionActive, setConstitutionActive] = useState<number | null>(null);
  const [constitutionTotal, setConstitutionTotal] = useState<number | null>(null);
  const [noGoCount, setNoGoCount] = useState<number | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [govError, setGovError] = useState<string | null>(null);

  useEffect(() => {
    if (!userEmail) return;
    let alive = true;
    setDataLoading(true);
    (async () => {
      try {
        const [cycleRes, memoryRes] = await Promise.all([
          supabase
            .from('executive_cycles')
            .select('cycle_number, situation_assessment, founder_briefing, model_used, observed_state, created_at')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('fleet_memory')
            .select('memory_type, created_at')
            .eq('source_department', 'EXECUTIVE')
            .order('created_at', { ascending: false })
            .limit(200),
        ]);
        if (!alive) return;
        if (cycleRes.error) throw cycleRes.error;
        setCycle((cycleRes.data as ExecutiveCycleRow | null) ?? null);
        setMemoryEntries((memoryRes.data as MemoryEntry[] | null) ?? []);
      } catch (e) {
        if (alive) setDataError(e instanceof Error ? e.message : 'Failed to load intelligence data');
      }

      // Governance/Workforce data — a separate, independent try/catch so a
      // failure here never corrupts the Briefing panel's own error state.
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const res = await fetch('https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/governance-dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const govRes = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(govRes?.error || 'governance-dashboard failed');
        setWorkforce(Array.isArray(govRes.workforce) ? govRes.workforce : []);
        setGovViolations(Array.isArray(govRes.violations) ? govRes.violations.length : null);
        setGovApprovalQueue(govRes.summary?.approval_queue ?? null);
        setConstitutionActive(govRes.constitution?.active ?? null);
        setConstitutionTotal(govRes.constitution?.total ?? null);
        const departments = Array.isArray(govRes.department_status) ? govRes.department_status : [];
        setNoGoCount(departments.filter((d: { status?: string }) => d.status === 'NO_GO' || d.status === 'UNSTAFFED').length);
      } catch (e) {
        if (alive) setGovError(e instanceof Error ? e.message : 'Failed to load governance data');
      }

      if (alive) setDataLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [userEmail]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--cockpit-bg-deep)' }}>
        <span className="text-sm text-slate-500">Loading…</span>
      </div>
    );
  }

  if (!userEmail) {
    return (
      <LoginPage
        onLoggedIn={() => {
          /* onAuthStateChange listener updates userEmail automatically */
        }}
      />
    );
  }

  const founderDecisionProfile = cycle?.observed_state?.founder_decision_profile ?? null;
  const cycleAgeHours = cycle ? (Date.now() - new Date(cycle.created_at).getTime()) / 36e5 : null;
  const intelligenceReady = cycleAgeHours !== null && cycleAgeHours < 24;
  const orbCaption = dataLoading ? 'Idle' : cycle ? `Last Cycle ${rel(cycle.created_at)}` : 'Awaiting First Cycle';
  const constitutionReady = constitutionActive !== null && constitutionTotal !== null && constitutionActive === constitutionTotal;
  const governanceReady = govViolations !== null && govViolations === 0;
  const systemHealthReady = noGoCount !== null && noGoCount === 0;

  return (
    <div className="relative isolate min-h-screen w-full overflow-hidden">
      <CockpitBackground />

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
        {/* HERO: header + orb kept tightly coupled so the orb reads as the
            anchor of the first viewport, not a separate, disconnected block. */}
        <div className="flex flex-col items-center gap-6 lg:items-stretch">
          <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <FounderGreetingBar />
            <div className="lg:w-56">
              <StatusRail
                readiness={{
                  Constitution: constitutionReady,
                  Governance: governanceReady,
                  Intelligence: intelligenceReady,
                  'System Health': systemHealthReady,
                }}
              />
            </div>
          </div>

          <div className="flex flex-col items-center justify-center gap-3">
            <IntelligenceOrb size={360} />
            <CockpitLabel>FKAIOS Intelligence Core &middot; {orbCaption}</CockpitLabel>
          </div>
        </div>

        {/* CONTENT: panels + growth strip, clearly separated from the hero above */}
        <div className="mt-12 space-y-6 lg:space-y-8">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:gap-6">
            <CockpitPanel title="AI CEO Briefing" subtitle="STRATEGIC INTELLIGENCE">
              <BriefingPanelBody
                loading={dataLoading}
                error={dataError}
                cycle={cycle}
                founderDecisionProfile={founderDecisionProfile}
              />
            </CockpitPanel>
            <CockpitPanel title="AI Workforce" subtitle="DIGITAL EMPLOYEES">
              {dataLoading ? (
                <AwaitingConnection icon={Cpu} />
              ) : govError ? (
                <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 py-8 text-center">
                  <Cpu className="w-6 h-6 text-slate-700" />
                  <p className="text-xs text-red-400/80">Could not load workforce data</p>
                </div>
              ) : (
                <WorkforcePanel workforce={workforce} />
              )}
            </CockpitPanel>
            <CockpitPanel
              title="Governance Health"
              subtitle="CONSTITUTION MONITORING"
              status={
                !dataLoading && !govError && govViolations !== null
                  ? govViolations > 0
                    ? { label: 'Attention', tone: 'critical' }
                    : { label: 'Clear', tone: 'ok' }
                  : undefined
              }
            >
              <GovernanceHealthBody
                loading={dataLoading}
                error={govError}
                violations={govViolations}
                approvalQueue={govApprovalQueue}
                constitutionActive={constitutionActive}
                constitutionTotal={constitutionTotal}
                noGoCount={noGoCount}
              />
            </CockpitPanel>
            <CockpitPanel title="Founder Approval Queue" subtitle="DECISION CONTROL">
              <DecisionCenter compact limit={5} />
            </CockpitPanel>
          </div>

          <IntelligenceGrowthStrip
            memoryEntries={memoryEntries}
            rulingsRecorded={founderDecisionProfile?.history.rulingsRecorded ?? null}
            totalDecisions={founderDecisionProfile?.history.totalDecisions ?? null}
            loading={dataLoading}
          />
        </div>
      </div>
    </div>
  );
}
