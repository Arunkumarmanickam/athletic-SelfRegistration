// Exports every public table to JSON via the Supabase REST API.
//
// `supabase db dump` needs Docker, which is not installed on this machine, and
// there is no pg_dump / psql either. For a database this size the REST API is a
// perfectly adequate dump path: it returns rows as JSON, which is portable,
// human-readable, and restorable via `insert` statements or the dashboard's
// import. Schema itself is NOT dumped here â€” it is rebuilt from the migration
// files in `supabase/migrations/`, which are the source of truth for structure.
import { mkdirSync, writeFileSync } from 'node:fs'

const URL_BASE = 'https://urlkpbvvtossdzsjcmie.supabase.co/rest/v1'
const KEY = process.env.SUPABASE_ANON_KEY
const OUT = process.argv[2] ?? './database'

if (!KEY) {
  console.error('SUPABASE_ANON_KEY is required')
  process.exit(1)
}

const TABLES = [
  'admin_users',
  'app_settings',
  'athlete_profiles',
  'athlete_sessions',
  'audit_logs',
  'championship_categories',
  'championship_events',
  'championships',
  'default_categories',
  'default_events',
  'id_sequences',
  'payment_events',
  'payment_orders',
  'payments',
  'rate_limits',
  'receipt_tokens',
  'registration_drafts',
  'registration_events',
  'registrations',
]

mkdirSync(OUT, { recursive: true })

const summary = []
let total = 0

for (const table of TABLES) {
  // `limit` is capped per request; page through so nothing is silently dropped.
  const rows = []
  const PAGE = 1000
  let offset = 0

  for (;;) {
    const res = await fetch(`${URL_BASE}/${table}?select=*&limit=${PAGE}&offset=${offset}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
    if (!res.ok) {
      summary.push(`${table.padEnd(26)} FAILED (${res.status}) ${await res.text()}`)
      break
    }
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE) break
    offset += PAGE
  }

  writeFileSync(`${OUT}/${table}.json`, JSON.stringify(rows, null, 2))
  total += rows.length
  summary.push(`${table.padEnd(26)} ${String(rows.length).padStart(6)} rows`)
}

console.log(summary.join('\n'))
console.log(`\n${TABLES.length} tables, ${total} rows total`)

