import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdminJS from 'adminjs'
import AdminJSExpress from '@adminjs/express'
import { Adapter, Database, Resource } from '@adminjs/sql'
import express from 'express'
import { TR_TRANSLATIONS } from './translations.js'
import { buildResources } from './resources.js'
import { Components, componentLoader } from './components.js'
import { dashboardHandler } from './stats.js'
import {
  citiesHubHandler,
  cityGroupedHandler,
  universitiesHubHandler,
  universityGroupedHandler,
} from './hubs.js'

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

/**
 * Required secret — throws if unset OR empty. No fallback defaults: a baked-in
 * password / cookie secret would let the panel boot with a publicly-known
 * credential and a forgeable session-signing key (auth bypass). Set these in
 * apps/admin/.env (gitignored); cookie secret should be ≥32 random bytes.
 */
function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required (see apps/admin/.env)`)
  return v
}

const DATABASE_URL = requireEnv('DATABASE_URL')
const ADMIN_EMAIL = requireEnv('ADMIN_EMAIL')
const ADMIN_PASSWORD = requireEnv('ADMIN_PASSWORD')
const COOKIE_SECRET = requireEnv('ADMIN_COOKIE_SECRET')
const PORT = Number(process.env.ADMIN_PORT ?? 3020)
// Supabase's default db is 'postgres'; override for self-hosted / differently-named DBs.
const DB_NAME = process.env.ADMIN_DB_NAME ?? 'postgres'

const start = async (): Promise<void> => {
  const publicDb = await new Adapter('postgresql', {
    connectionString: DATABASE_URL,
    database: DB_NAME,
  }).init()

  // Second adapter scoped to the `auth` schema purely to expose auth.users.
  const authDb = await new Adapter('postgresql', {
    connectionString: DATABASE_URL,
    database: DB_NAME,
    schema: 'auth',
  }).init()

  const admin = new AdminJS({
    rootPath: '/admin',
    // Kurumsal ekler kimliği. AdminJS varsayılan markası (logo.svg, "AdminJS"
    // şirket adı, "made with love" rozeti) tamamen değiştirilir; bordo paleti +
    // ekler mark/sözcük markası gelir. Görsel öğeler /public altından servis edilir
    // (express.static, aşağıda), Login + SidebarBranding override'ları components.ts'te.
    branding: {
      companyName: 'ekler',
      logo: '/public/ekler-mark-dark.png',
      favicon: '/public/ekler-favicon.png',
      withMadeWithLove: false,
      theme: {
        colors: {
          primary100: '#9E2035',
          primary80: '#B23A4D',
          primary60: '#C66576',
          primary40: '#DC97A2',
          primary20: '#F2D6DB',
          accent: '#9E2035',
          love: '#9E2035',
          filterBg: '#5A1320',
          hoverBg: '#7A1C2E',
        },
      },
    },
    assets: {
      // Marka fontu (@font-face Ekler) + .ekler-brand / .ekler-login stilleri.
      styles: ['/public/ekler-admin.css'],
    },
    componentLoader,
    dashboard: { component: Components.Dashboard, handler: dashboardHandler },
    pages: {
      // cross hubs (dimension → all related content)
      universitiesHub: { component: Components.Hub, handler: universitiesHubHandler, icon: 'Award' },
      citiesHub: { component: Components.Hub, handler: citiesHubHandler, icon: 'Map' },
      // per-resource grouped landings (one resource grouped by its dimension)
      profilesByUni: { component: Components.Hub, handler: universityGroupedHandler('profiles', 'Profil', 'Profiller — Üniversiteye göre'), icon: 'User' },
      confessionsByUni: { component: Components.Hub, handler: universityGroupedHandler('confessions', 'İtiraf', 'İtiraflar — Üniversiteye göre'), icon: 'MessageSquare' },
      notesByUni: { component: Components.Hub, handler: universityGroupedHandler('notes', 'Not', 'Notlar — Üniversiteye göre'), icon: 'FileText' },
      communitiesByUni: { component: Components.Hub, handler: universityGroupedHandler('communities', 'Topluluk', 'Topluluklar — Üniversiteye göre'), icon: 'Users' },
      sessionsByUni: { component: Components.Hub, handler: universityGroupedHandler('study_sessions', 'Oturum', 'Çalışma Oturumları — Üniversiteye göre'), icon: 'Calendar' },
      coursesByUni: { component: Components.Hub, handler: universityGroupedHandler('courses', 'Ders', 'Dersler — Üniversiteye göre'), icon: 'BookOpen' },
      eventsByCity: { component: Components.Hub, handler: cityGroupedHandler('city_events', 'Etkinlik', 'Şehir Etkinlikleri — Şehre göre'), icon: 'Calendar' },
      submissionsByCity: { component: Components.Hub, handler: cityGroupedHandler('event_submissions', 'Başvuru', 'Etkinlik Başvuruları — Şehre göre'), icon: 'Inbox' },
    },
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
  // Marka varlıkları (logo, favicon, CSS, font) — AdminJS bunları kendisi servis
  // etmez; branding/assets'teki /public/* yolları buradan karşılanır.
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  app.use('/public', express.static(path.join(__dirname, '../public')))
  // Kök '/' istekleri panele yönlensin; aksi halde Express "Cannot GET /" döner
  // (AdminJS yalnızca rootPath '/admin' altına mount ediliyor).
  app.get('/', (_req, res) => res.redirect(admin.options.rootPath))
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
