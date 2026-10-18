#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Create the FIRST (owner) administrator for the Athlete Registration Portal.
//
// There is deliberately no public administrator sign-up. This script calls the
// `admin-bootstrap` Edge Function, which only succeeds while no active owner
// exists and only when the correct BOOTSTRAP_ADMIN_SECRET is supplied.
//
// Usage:
//   npm run create-admin -- --email owner@example.org --name "Jane Doe"
//   npm run create-admin -- --email owner@example.org --password "a-long-passphrase"
//
// Values can also come from the environment (VITE_SUPABASE_URL,
// VITE_SUPABASE_ANON_KEY, BOOTSTRAP_ADMIN_SECRET) or from a local .env file,
// which this script reads if present. Missing values are prompted for.
//
// After it succeeds, store the printed password securely and delete the
// BOOTSTRAP_ADMIN_SECRET from your Edge Function secrets.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

// ---- tiny .env parser (no dependency) --------------------------------------

function loadDotEnv() {
  const candidates = ['.env.local', '.env']
  const values = {}
  for (const file of candidates) {
    const path = resolve(process.cwd(), file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in values)) values[key] = value
    }
  }
  return values
}

// ---- argument parsing ------------------------------------------------------

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1)
    } else {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args[token.slice(2)] = next
        i += 1
      } else {
        args[token.slice(2)] = 'true'
      }
    }
  }
  return args
}

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

async function main() {
  const dotenv = loadDotEnv()
  const args = parseArgs(process.argv.slice(2))

  const env = (key) => process.env[key] ?? dotenv[key] ?? ''

  let supabaseUrl = (args.url || env('VITE_SUPABASE_URL') || '').replace(/\/+$/, '')
  let anonKey = args.key || env('VITE_SUPABASE_ANON_KEY') || ''
  let secret = args.secret || env('BOOTSTRAP_ADMIN_SECRET') || ''
  let email = args.email || ''
  let fullName = args.name || args.fullName || ''
  let password = args.password || ''

  const needsPrompt = !supabaseUrl || !anonKey || !secret || !email
  const rl = needsPrompt ? createInterface({ input, output }) : null

  try {
    if (!supabaseUrl) supabaseUrl = (await rl.question('Supabase project URL: ')).trim().replace(/\/+$/, '')
    if (!anonKey) anonKey = (await rl.question('Supabase anon (public) key: ')).trim()
    if (!secret) secret = (await rl.question('BOOTSTRAP_ADMIN_SECRET: ')).trim()
    if (!email) email = (await rl.question('Owner email address: ')).trim()
    if (!fullName && rl) fullName = (await rl.question('Owner full name (optional): ')).trim()
    if (!password && rl) password = (await rl.question('Password (optional, min 12 chars; blank to auto-generate): ')).trim()
  } finally {
    rl?.close()
  }

  if (!supabaseUrl) fail('A Supabase project URL is required.')
  if (!anonKey) fail('A Supabase anon key is required.')
  if (!secret) fail('The BOOTSTRAP_ADMIN_SECRET is required.')
  if (!email) fail('An owner email address is required.')
  if (password && password.length < 12) fail('The password must be at least 12 characters long.')

  const endpoint = `${supabaseUrl}/functions/v1/admin-bootstrap`
  console.log(`\n→ Calling ${endpoint}`)

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        secret,
        email,
        ...(fullName ? { fullName } : {}),
        ...(password ? { password } : {}),
      }),
    })
  } catch (error) {
    fail(`Could not reach the Edge Function: ${error instanceof Error ? error.message : String(error)}`)
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`
    const message = payload?.error?.message ?? 'The request was rejected.'
    fail(`${code}: ${message}`)
  }

  console.log('\n✔ Owner administrator created')
  console.log(`   Email:    ${payload.email}`)
  console.log(`   Password: ${payload.temp_password}`)
  console.log('\nStore this password securely — it is shown only once.')
  console.log('You may now delete the BOOTSTRAP_ADMIN_SECRET from your Edge Function secrets.\n')
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
