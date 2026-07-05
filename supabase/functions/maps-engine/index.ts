// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v43 pulled 2026-07-05):
// Real function — uses OpenStreetMap Nominatim (free, no API key) for
// place search, with a single 429 retry (2s backoff, one attempt only).
// No DB writes in 'search' or 'debug' actions (results returned directly
// to caller, not persisted to maps_search_results — that table is
// populated elsewhere, e.g. by a caller that inserts the returned
// `places` array itself). Minor flag: `type` var (line ~40s) shadows
// builtin-ish naming but not a bug; rating/reviews are always hardcoded
// 0 since Nominatim doesn't provide them — not Google Maps data despite
// the function name.
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    const body = await req.json()
    const { action, searchStr } = body

    if (action === 'debug') {
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?q=pizza+in+new+york&format=json&limit=1', {
          headers: { 'User-Agent': 'FK-AOS-MapsEngine/1.0' }
        })
        const d = await r.json()
        if (r.ok) {
          return new Response(JSON.stringify({ status: 'ok', provider: 'OpenStreetMap Nominatim', message: 'Connected' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({ status: 'error', error: 'Nominatim returned status ' + r.status }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      } catch (e) {
        return new Response(JSON.stringify({ status: 'error', error: e.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    if (action === 'search') {
      if (!searchStr || searchStr.trim().length === 0) {
        return new Response(JSON.stringify({ error: 'searchStr is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const query = encodeURIComponent(searchStr.trim())
      var url = 'https://nominatim.openstreetmap.org/search?q=' + query + '&format=json&limit=20&addressdetails=1&extratags=1'
      var r = await fetch(url, { headers: { 'User-Agent': 'FK-AOS-MapsEngine/1.0' } })
      if (r.status === 429) {
        await new Promise(function(resolve) { setTimeout(resolve, 2000) })
        r = await fetch(url, { headers: { 'User-Agent': 'FK-AOS-MapsEngine/1.0' } })
      }
      var data = await r.json()
      if (!r.ok) {
        var errMsg = 'Search failed'
        if (typeof data === 'object' && data.error) errMsg = data.error
        return new Response(JSON.stringify({ error: errMsg, status: r.status }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      if (!Array.isArray(data) || data.length === 0) {
        return new Response(JSON.stringify({ success: true, count: 0, places: [], message: 'No results found for "' + searchStr.trim() + '". Try adding a city name.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      var places = data.map(function(p) {
        var type = (p.type || '')
        var category = (p.category || '')
        if (p.extratags && p.extratags.cuisine) type = p.extratags.cuisine
        if (p.extratags && p.extratags.brand) type = p.extratags.brand + ' - ' + type
        var phone = 'N/A'
        var website = 'N/A'
        if (p.extratags) {
          if (p.extratags.phone) phone = p.extratags.phone
          if (p.extratags.website) website = p.extratags.website
          if (p.extratags['contact:phone']) phone = p.extratags['contact:phone']
          if (p.extratags['contact:website']) website = p.extratags['contact:website']
        }
        return {
          name: p.display_name ? p.display_name.split(',')[0] : (p.name || 'Unknown'),
          address: p.display_name || 'N/A',
          rating: 0,
          reviews: 0,
          types: category + ' / ' + type,
          phone: phone,
          website: website,
          lat: parseFloat(p.lat) || 0,
          lng: parseFloat(p.lon) || 0,
          placeId: String(p.place_id || ''),
          photoUrl: ''
        }
      })
      return new Response(JSON.stringify({ success: true, count: places.length, places: places }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
