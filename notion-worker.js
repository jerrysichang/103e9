/**
 * Diet <- Notion bridge (Cloudflare Worker).
 *
 * GET /diet?date=YYYY-MM-DD
 *   -> { date, targets: { calories, proteinG, carbsG, fatG, dayType } | null,
 *        entries: [{ id, loggedAt, description, source: 'notion', analysis: {...} }] }
 *
 * Reads the J-OS Diet databases in Notion that Claude writes to when logging food:
 *   - Food log      (one row per thing eaten)
 *   - Daily targets (one row per day: day type + kcal/P/C/F)
 *
 * Secrets / vars (Settings -> Variables):
 *   NOTION_TOKEN  (secret)  Notion internal integration token, shared with the Diet page
 *   DIET_KEY      (secret)  any long random string; the app sends it as a Bearer token
 *   ALLOWED_ORIGIN (var, optional) e.g. https://your-103e9-domain - defaults to *
 */

const FOOD_LOG_DB = 'f2a5c0009a034f4b8633b74441916a8e'
const DAILY_TARGETS_DB = 'e4170ed9ff7c4f459c4a656e362adf34'
const NOTION_VERSION = '2022-06-28'
const CACHE_SECONDS = 30

export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Vary': 'Origin',
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors)

    const url = new URL(request.url)
    if (url.pathname !== '/diet') return json({ error: 'Not found' }, 404, cors)

    const auth = request.headers.get('Authorization') || ''
    if (!env.DIET_KEY || auth !== `Bearer ${env.DIET_KEY}`) {
      return json({ error: 'Unauthorized' }, 401, cors)
    }

    const date = url.searchParams.get('date') || ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Bad date' }, 400, cors)

    // Short edge cache keyed by date (auth already checked above).
    const cache = caches.default
    const cacheKey = new Request(`https://diet-cache.internal/diet/${date}`)
    if (url.searchParams.get('fresh') !== '1') {
      const hit = await cache.match(cacheKey)
      if (hit) return withHeaders(hit, cors)
    }

    try {
      const [logRows, targetRows] = await Promise.all([
        queryByDate(env, FOOD_LOG_DB, date),
        queryByDate(env, DAILY_TARGETS_DB, date),
      ])

      const entries = logRows.map(row => {
        const p = row.properties || {}
        return {
          id: `notion-${row.id}`,
          loggedAt: row.created_time,
          description: text(p.Notes),
          source: 'notion',
          meal: select(p.Meal),
          analysis: {
            summary: title(p.Item) || 'Logged meal',
            calories: num(p.kcal),
            proteinG: num(p['Protein g']),
            carbsG: num(p['Carbs g']),
            fatG: num(p['Fat g']),
          },
        }
      }).sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : -1)) // newest first, like the app

      const t = targetRows[0]?.properties
      const targets = t ? {
        dayType: select(t['Day type']),
        calories: num(t.kcal),
        proteinG: num(t['Protein g']),
        carbsG: num(t['Carbs g']),
        fatG: num(t['Fat g']),
      } : null

      const res = json({ date, targets, entries }, 200, {
        'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
      })
      ctx.waitUntil(cache.put(cacheKey, res.clone()))
      return withHeaders(res, cors)
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 502, cors)
    }
  },
}

async function queryByDate(env, databaseId, date) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: { property: 'Date', date: { equals: date } },
      page_size: 100,
    }),
  })
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.results || []
}

const num = p => (p && typeof p.number === 'number' ? p.number : 0)
const title = p => (p?.title || []).map(t => t.plain_text).join('')
const text = p => (p?.rich_text || []).map(t => t.plain_text).join('')
const select = p => p?.select?.name || ''

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function withHeaders(res, extra) {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v)
  return out
}
