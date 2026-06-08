// Post-pull normalizer for drizzle-kit introspection quirks.
// Runs after `drizzle-kit pull` (see package.json db:pull) so the fixes are
// reproducible and CI's drift check stays green. All quirks below originate in
// the Supabase `auth` schema (introspected only so public FKs to auth.users
// resolve) or in mutually-referential public tables.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'src', 'db', 'schema')

function patch(file, fixes) {
  const path = join(dir, file)
  let src = readFileSync(path, 'utf8')
  const before = src
  const notes = []
  for (const [label, fn] of fixes) {
    const next = fn(src)
    if (next !== src) notes.push(label)
    src = next
  }
  if (src !== before) {
    writeFileSync(path, src, 'utf8')
    console.log(`[fix-introspection] ${file}: ${notes.join(', ')}`)
  } else {
    console.log(`[fix-introspection] ${file}: nothing to patch`)
  }
}

// Generated files are machine-produced; @ts-nocheck silences strict-TS noise
// (e.g. the eventSubmissions<->cityEvents circular FK that defeats inference).
// Consumption sites (repositories) are still fully type-checked.
const addTsNoCheck = (s) => (s.startsWith('// @ts-nocheck') ? s : `// @ts-nocheck\n${s}`)

patch('schema.ts', [
  // Empty-string defaults emitted as a broken `.default(')` instead of `.default('')`.
  ["empty-string defaults", (s) => s.replaceAll(".default(')", ".default('')")],
  // `bytea` columns drizzle-kit can't map become `unknown(...)` (not a value → runtime
  // crash). Only in auth.webauthn_credentials, which we never query → map to text.
  ['unmapped bytea→text', (s) => s.replaceAll('unknown("', 'text("')],
  ['@ts-nocheck', addTsNoCheck],
])

patch('relations.ts', [['@ts-nocheck', addTsNoCheck]])
