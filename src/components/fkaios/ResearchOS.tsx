'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, MapPin, Phone, Globe, Loader2, AlertCircle, Building2 } from 'lucide-react';

interface Place {
  name: string;
  address: string;
  types: string;
  phone: string;
  website: string;
  lat: number;
  lng: number;
}

export default function ResearchOS() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Place[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setMessage(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('maps-engine', {
        body: { action: 'search', searchStr: query.trim() },
      });
      if (invokeErr || data?.error) {
        throw new Error(data?.error || invokeErr?.message || 'Search failed');
      }
      setResults(data.places || []);
      if (data.message) setMessage(data.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Search className="w-5 h-5 text-emerald-400" />
        <div>
          <h2 className="text-lg font-semibold">Research — Business & Location Search</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real search via OpenStreetMap — free, no fabricated results. Try &quot;restaurants in Delhi&quot; or &quot;gyms in Mumbai&quot;.
          </p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="e.g. franchise consultants in Bangalore"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white"
          />
          <button
            onClick={search}
            disabled={loading || !query.trim()}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {message && (
        <div className="text-sm text-slate-500 bg-slate-800/50 rounded-xl px-4 py-3">{message}</div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{results.length} real result{results.length !== 1 ? 's' : ''}</p>
          {results.map((place, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{place.name}</p>
                  {place.types && place.types !== ' / ' && (
                    <p className="text-xs text-slate-500 mt-0.5">{place.types}</p>
                  )}
                  <p className="text-xs text-slate-500 mt-1.5 flex items-start gap-1.5">
                    <MapPin className="w-3 h-3 mt-0.5 shrink-0" /> {place.address}
                  </p>
                  <div className="flex gap-4 mt-2">
                    {place.phone && place.phone !== 'N/A' && (
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {place.phone}
                      </span>
                    )}
                    {place.website && place.website !== 'N/A' && (
                      <a href={place.website} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 flex items-center gap-1 hover:underline">
                        <Globe className="w-3 h-3" /> Website
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
