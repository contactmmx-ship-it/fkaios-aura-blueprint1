// ──────────────────────────────────────────────────────────────────
// Structured Metrics for Edge Functions (Phase 9)
// ──────────────────────────────────────────────────────────────────
// Provides recordMetric() and getMetrics() for tracking application
// telemetry: latency, token usage, cost, conversions, errors, etc.
//
// Usage in edge functions:
//   import { recordMetric, getMetrics } from '../_shared/metrics.ts';
//   await recordMetric(supabase, 'api_latency_ms', 142, { function: 'ai-engine' });
//
// Import with: import { ... } from '../_shared/metrics.ts';

import { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface MetricRecord {
  id: string;
  name: string;
  value: number;
  unit: string;
  tags: Record<string, string | number | boolean | null>;
  recorded_at: string;
}

export interface MetricAggregate {
  id: string;
  metric_name: string;
  period_date: string;
  period_type: 'hourly' | 'daily' | 'weekly' | 'monthly';
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  tags: Record<string, string | number | boolean | null>;
  computed_at: string;
}

export interface MetricsQueryResult {
  metrics: MetricRecord[];
  aggregates?: MetricAggregate[];
  total: number;
  period: string;
}

/**
 * Known metric names for validation / documentation.
 * Not enforced at runtime — any name works — but helps with consistency.
 */
export const KNOWN_METRICS = [
  'api_latency_ms',
  'ai_tokens_used',
  'ai_cost_usd',
  'lead_conversion_count',
  'payment_success_count',
  'payment_failure_count',
  'error_count',
] as const;

export type KnownMetricName = (typeof KNOWN_METRICS)[number];

// ──────────────────────────────────────────────
// recordMetric — Write a metric to the metrics table
// ──────────────────────────────────────────────
// Parameters:
//   supabase     — Supabase client (service role)
//   name         — Metric name (e.g., 'api_latency_ms')
//   value        — Numeric value
//   tags         — Optional key-value tags for filtering (function name, model, etc.)
//   unit         — Optional unit string (e.g., 'ms', 'tokens', 'usd', 'count')
//   recordedAt   — Optional timestamp (defaults to now)
//
// Returns the inserted row or null on failure.
export async function recordMetric(
  supabase: SupabaseClient,
  name: string,
  value: number,
  tags: Record<string, string | number | boolean | null> = {},
  unit?: string,
  recordedAt?: string,
): Promise<MetricRecord | null> {
  const record = {
    name,
    value,
    unit: unit || inferUnit(name),
    tags,
    recorded_at: recordedAt || new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('metrics')
      .insert(record)
      .select()
      .single();

    if (error) {
      console.error(`[metrics] Failed to record metric "${name}":`, error.message);
      return null;
    }

    return data as MetricRecord;
  } catch (err) {
    console.error(`[metrics] Unexpected error recording metric "${name}":`, err);
    return null;
  }
}

// ──────────────────────────────────────────────
// recordMetricBatch — Write multiple metrics in one call
// ──────────────────────────────────────────────
export async function recordMetricBatch(
  supabase: SupabaseClient,
  metrics: Array<{
    name: string;
    value: number;
    tags?: Record<string, string | number | boolean | null>;
    unit?: string;
  }>,
): Promise<{ success: number; failed: number }> {
  const records = metrics.map((m) => ({
    name: m.name,
    value: m.value,
    unit: m.unit || inferUnit(m.name),
    tags: m.tags || {},
    recorded_at: new Date().toISOString(),
  }));

  try {
    const { error } = await supabase.from('metrics').insert(records);
    if (error) {
      console.error('[metrics] Batch insert failed:', error.message);
      return { success: 0, failed: records.length };
    }
    return { success: records.length, failed: 0 };
  } catch (err) {
    console.error('[metrics] Unexpected error in batch insert:', err);
    return { success: 0, failed: records.length };
  }
}

// ──────────────────────────────────────────────
// getMetrics — Read metrics for a period
// ──────────────────────────────────────────────
// Parameters:
//   supabase  — Supabase client
//   period    — Time period:
//                 '1h', '6h', '24h', '7d', '30d', '90d'
//                 or explicit ISO date range: { start: '...', end: '...' }
//   name      — Optional metric name filter
//   tags      — Optional tag filters (exact match on each key)
//   limit     — Max rows to return (default 1000)
//   offset    — Offset for pagination (default 0)
//
// Returns: { metrics, aggregates?, total, period }
export async function getMetrics(
  supabase: SupabaseClient,
  period: string | { start: string; end: string },
  name?: string,
  tags?: Record<string, string>,
  limit = 1000,
  offset = 0,
): Promise<MetricsQueryResult> {
  // Parse period
  let startTime: string;
  let endTime: string;

  if (typeof period === 'object' && period.start && period.end) {
    startTime = period.start;
    endTime = period.end;
  } else {
    const now = new Date();
    const periodStr = period as string;
    const match = periodStr.match(/^(\d+)(h|d)$/);
    if (!match) {
      // Default to 24h
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      endTime = now.toISOString();
    } else {
      const amount = parseInt(match[1], 10);
      const unit = match[2];
      const ms = unit === 'h' ? amount * 60 * 60 * 1000 : amount * 24 * 60 * 60 * 1000;
      startTime = new Date(now.getTime() - ms).toISOString();
      endTime = now.toISOString();
    }
  }

  try {
    let query = supabase
      .from('metrics')
      .select('*', { count: 'exact' })
      .gte('recorded_at', startTime)
      .lte('recorded_at', endTime)
      .order('recorded_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (name) {
      query = query.eq('name', name);
    }

    // Tag filters — uses JSONB containment
    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        query = query.eq(`tags->>${key}`, value);
      }
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[metrics] Failed to fetch metrics:', error.message);
      return { metrics: [], total: 0, period: `${startTime}/${endTime}` };
    }

    return {
      metrics: (data || []) as MetricRecord[],
      total: count || 0,
      period: `${startTime}/${endTime}`,
    };
  } catch (err) {
    console.error('[metrics] Unexpected error fetching metrics:', err);
    return { metrics: [], total: 0, period: `${startTime}/${endTime}` };
  }
}

// ──────────────────────────────────────────────
// getMetricSummary — Get aggregated stats for a metric
// ──────────────────────────────────────────────
// Returns count, sum, avg, min, max for a metric within a period.
export async function getMetricSummary(
  supabase: SupabaseClient,
  name: string,
  period: string | { start: string; end: string },
  tags?: Record<string, string>,
): Promise<{
  name: string;
  count: number;
  sum: number;
  avg: number;
  min: number | null;
  max: number | null;
  period: string;
} | null> {
  // Parse period (same logic as getMetrics)
  let startTime: string;
  let endTime: string;

  if (typeof period === 'object' && period.start && period.end) {
    startTime = period.start;
    endTime = period.end;
  } else {
    const now = new Date();
    const periodStr = period as string;
    const match = periodStr.match(/^(\d+)(h|d)$/);
    if (!match) {
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      endTime = now.toISOString();
    } else {
      const amount = parseInt(match[1], 10);
      const unit = match[2];
      const ms = unit === 'h' ? amount * 60 * 60 * 1000 : amount * 24 * 60 * 60 * 1000;
      startTime = new Date(now.getTime() - ms).toISOString();
      endTime = now.toISOString();
    }
  }

  try {
    let query = supabase
      .from('metrics')
      .select('value')
      .gte('recorded_at', startTime)
      .lte('recorded_at', endTime)
      .eq('name', name);

    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        query = query.eq(`tags->>${key}`, value);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('[metrics] Failed to fetch metric summary:', error.message);
      return null;
    }

    const values = (data || []).map((r: { value: number }) => r.value);
    if (values.length === 0) {
      return {
        name,
        count: 0,
        sum: 0,
        avg: 0,
        min: null,
        max: null,
        period: `${startTime}/${endTime}`,
      };
    }

    const sum = values.reduce((a: number, b: number) => a + b, 0);

    return {
      name,
      count: values.length,
      sum: Math.round(sum * 1000) / 1000,
      avg: Math.round((sum / values.length) * 1000) / 1000,
      min: Math.min(...values),
      max: Math.max(...values),
      period: `${startTime}/${endTime}`,
    };
  } catch (err) {
    console.error('[metrics] Unexpected error fetching metric summary:', err);
    return null;
  }
}

// ──────────────────────────────────────────────
// Helper: Infer unit from metric name
// ──────────────────────────────────────────────
function inferUnit(name: string): string {
  if (name.endsWith('_ms')) return 'ms';
  if (name.endsWith('_usd') || name.includes('cost')) return 'usd';
  if (name.includes('token')) return 'tokens';
  if (name.includes('count') || name.includes('conversion')) return 'count';
  if (name.includes('error') || name.includes('failure')) return 'count';
  if (name.includes('latency') || name.includes('duration')) return 'ms';
  return 'count';
}

// ──────────────────────────────────────────────
// Helper: Measure execution time of an async function
// ──────────────────────────────────────────────
// Wraps an async function, records api_latency_ms metric, and returns the result.
export async function measureLatency<T>(
  supabase: SupabaseClient,
  functionName: string,
  fn: () => Promise<T>,
  extraTags: Record<string, string | number | boolean | null> = {},
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const elapsed = Math.round(performance.now() - start);

    await recordMetric(supabase, 'api_latency_ms', elapsed, {
      function: functionName,
      success: true,
      ...extraTags,
    });

    return result;
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);

    await recordMetric(supabase, 'api_latency_ms', elapsed, {
      function: functionName,
      success: false,
      ...extraTags,
    });

    await recordMetric(supabase, 'error_count', 1, {
      function: functionName,
      error_type: err instanceof Error ? err.name : 'unknown',
      ...extraTags,
    });

    throw err;
  }
}