import 'dotenv/config'
import AdminJS from 'adminjs'
import AdminJSExpress from '@adminjs/express'
import { Adapter, Database, Resource } from '@adminjs/sql'
import express from 'express'
import { TR_TRANSLATIONS } from './translations.js'
import { buildResources } from './resources.js'

/**
 * Ekler Admin — v2.
 *
 * A login-protected panel over the main tables, served as a SEPARATE Express
 * process (AdminJS v7 is ESM + Express-coupled, so it can't mount on the Fastify
 * API). Auth is a single env-configured admin for now; wiring to the
 * admin_identities RBAC tables comes with the full Phase 5 build.
 *
 * Resource layout (grouped nav, curated columns, sort, hidden secrets, read-only
 * counters) lives in resources.ts; Turkish UI strings in translations.ts.
 *
 * auth.users is exposed (full read/write by owner request) but its password hash,
 * OTP and recovery tokens are hidden via the HIDE policy in resources.ts. If this
 * panel is ever exposed publicly, lock auth.users down further.
 */
AdminJS.registerAdapter({ Database, Resource })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required (see apps/admin/.env)')

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@ekler.app'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ekler-admin'
const COOKIE_SECRET = process.env.ADMIN_COOKIE_SECRET ?? 'dev-cookie-secret-change-me'
const PORT = Number(process.env.ADMIN_PORT ?? 3020)

const start = async (): Promise<void> => {
  const publicDb = await new Adapter('postgresql', {
    connectionString: DATABASE_URL,
    database: 'postgres',
  }).init()

  // Second adapter scoped to the `auth` schema purely to expose auth.users.
  const authDb = await new Adapter('postgresql', {
    connectionString: DATABASE_URL,
    database: 'postgres',
    schema: 'auth',
  }).init()

  const admin = new AdminJS({
    rootPath: '/admin',
    branding: { companyName: 'Ekler Yönetim' },
    locale: {
      language: 'tr',
      availableLanguages: ['tr'],
      translations: { tr: TR_TRANSLATIONS },
    },
    resources: buildResources(publicDb, authDb),
  })

  if (process.env.NODE_ENV !== 'production') admin.watch()

  const authenticate = async (email: string, password: string) => {
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) return { email }
    return null
  }

  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    { authenticate, cookieName: 'ekler_admin', cookiePassword: COOKIE_SECRET },
    null,
    { resave: false, saveUninitialized: false, secret: COOKIE_SECRET },
  )

  const app = express()
  app.use(admin.options.rootPath, router)
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Ekler Admin → http://localhost:${PORT}${admin.options.rootPath}`)
  })
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
