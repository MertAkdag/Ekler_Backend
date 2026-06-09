import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import * as schema from '../schema'
import { SCOPED_TABLE_NAMES } from './scoped-table'

/**
 * Static anti-K-1 guard (layer 2 of the leak suite; layer 1 is the ScopedRepository
 * unit test, layer 3 is the behavioral 2-university test).
 *
 * The leak risk is structural: services hold the raw `db` AND must remember to route
 * tenancy through ScopedRepository. Nothing in the type system forces it. This test
 * parses every *.service.ts and flags any method that runs a Drizzle query
 * (`.from/.insert/.update/.delete`) against a university-scoped table WITHOUT going
 * through the scope — i.e. the method (or a same-class helper it calls) never touches
 * `this.scope` and never names a `universityDomain` column.
 *
 * It is a heuristic, deliberately tuned to ZERO false positives against current code:
 * it catches the dangerous regression ("forgot tenancy entirely") and forces every new
 * scoped-table access to visibly go through scope. It does NOT prove the filter lands in
 * the WHERE clause (a method that merely selects `universityDomain` would pass) — that
 * deeper guarantee is the behavioral test's job.
 */

// drizzle table consts are camelCase of the snake_case table name.
const toCamel = (s: string): string => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())
const SCOPED_IDENTS = new Set(SCOPED_TABLE_NAMES.map(toCamel))
const QUERY_VERBS = new Set(['from', 'insert', 'update', 'delete'])

interface MethodInfo {
  name: string
  text: string
  scopedTablesTouched: { table: string; line: number }[]
  calls: Set<string> // same-class methods called as this.<name>(...)
}

interface Violation {
  file: string
  method: string
  table: string
  line: number
}

/** Parse one source file and return any scoped-table access that doesn't go through scope. */
function analyze(fileName: string, source: string): Violation[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const methods: MethodInfo[] = []

  const collectMethod = (m: ts.MethodDeclaration): void => {
    const name = m.name.getText(sf)
    const info: MethodInfo = { name, text: m.getText(sf), scopedTablesTouched: [], calls: new Set() }

    const walk = (node: ts.Node): void => {
      // .from(X) / .insert(X) / .update(X) / .delete(X) with X an identifier of a scoped table
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const verb = node.expression.name.text
        const arg0 = node.arguments[0]
        if (QUERY_VERBS.has(verb) && arg0 && ts.isIdentifier(arg0) && SCOPED_IDENTS.has(arg0.text)) {
          const line = sf.getLineAndCharacterOfPosition(arg0.getStart(sf)).line + 1
          info.scopedTablesTouched.push({ table: arg0.text, line })
        }
      }
      // this.<helper>(...) — record same-class method calls for transitive scope resolution
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        info.calls.add(node.expression.name.text)
      }
      ts.forEachChild(node, walk)
    }
    walk(m)
    methods.push(info)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member)) collectMethod(member)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // A method is "directly scoped" if it touches the chokepoint or names a tenancy column.
  const byName = new Map(methods.map((m) => [m.name, m]))
  const directlyScoped = (m: MethodInfo): boolean =>
    m.text.includes('this.scope') || /universityDomain/.test(m.text)

  // Transitive: a method is scoped if it's directly scoped or calls a scoped method.
  const scoped = new Map<string, boolean>(methods.map((m) => [m.name, directlyScoped(m)]))
  for (let changed = true; changed; ) {
    changed = false
    for (const m of methods) {
      if (scoped.get(m.name)) continue
      for (const callee of m.calls) {
        if (byName.has(callee) && scoped.get(callee)) {
          scoped.set(m.name, true)
          changed = true
          break
        }
      }
    }
  }

  const violations: Violation[] = []
  for (const m of methods) {
    if (scoped.get(m.name)) continue
    for (const t of m.scopedTablesTouched) {
      violations.push({ file: fileName, method: m.name, table: t.table, line: t.line })
    }
  }
  return violations
}

function serviceFiles(): string[] {
  // __dirname = src/db/scoped → service modules live at src/modules.
  const dir = join(__dirname, '..', '..', 'modules')
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((p) => p.endsWith('.service.ts'))
    .map((p) => join(dir, p))
}

describe('anti-K-1 static guard', () => {
  it('every scoped-table query in a service routes through ScopedRepository', () => {
    const files = serviceFiles()
    expect(files.length).toBeGreaterThan(0) // sanity: we actually scanned something
    const violations = files.flatMap((f) => analyze(f, readFileSync(f, 'utf8')))
    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.method}() touches ${v.table} unscoped — ${v.file}:${v.line}`)
        .join('\n')
      throw new Error(`Unscoped scoped-table access (anti-K-1 leak risk):\n${report}`)
    }
    expect(violations).toEqual([])
  })

  it('knows every launch-mandatory scoped table by its real schema export', () => {
    // If a table joins SCOPED_TABLE_NAMES, its drizzle const must exist — otherwise the
    // analyzer would silently stop watching it.
    for (const ident of SCOPED_IDENTS) {
      expect(schema, `schema is missing scoped table export "${ident}"`).toHaveProperty(ident)
    }
    expect(SCOPED_IDENTS.size).toBe(SCOPED_TABLE_NAMES.length)
  })

  it('actually fires on an unscoped query (negative self-test)', () => {
    const bad = `
      class BadService {
        async leak() {
          return this.db.select().from(confessions).where(eq(confessions.id, x))
        }
      }
    `
    const v = analyze('bad.service.ts', bad)
    expect(v).toHaveLength(1)
    expect(v[0]?.method).toBe('leak')
    expect(v[0]?.table).toBe('confessions')
  })

  it('does not fire when scope is reached via a helper (transitive, positive self-test)', () => {
    const ok = `
      class OkService {
        async write() {
          await this.requireInScope(id)
          return this.db.insert(sessionParticipants).values({})
        }
        private async requireInScope(id) {
          return this.db.select().from(studySessions)
            .where(this.scope.scopeFilter(studySessions.universityDomain))
        }
      }
    `
    expect(analyze('ok.service.ts', ok)).toEqual([])
  })
})
