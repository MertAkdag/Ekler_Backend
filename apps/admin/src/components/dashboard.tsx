import React, { useCallback, useEffect, useState } from 'react'
import { ApiClient } from 'adminjs'
import { Badge, Box, H2, H4, H5, Icon, Text } from '@adminjs/design-system'

// ---- payload mirror (must match DashboardPayload in stats.ts) -----------
type Tone = 'ok' | 'warn' | 'crit'
interface Kpi { key: string; label: string; value: number; delta: number | null; href: string; icon: string; tone: Tone }
interface QueueItem { id: string; targetType: string; targetLabel: string; reason: string; rel: string; href: string }
interface FlaggedItem { id: string; source: string; sourceLabel: string; flagKind: 'user' | 'auto'; label: string | null; snippet: string; university: string | null; rel: string; href: string }
interface AppealItem { id: string; typeLabel: string; reason: string; rel: string; href: string }
interface OpsItem { id: string; domainLabel: string; title: string; severity: string; state: string; owned: boolean; due: { text: string; overdue: boolean } | null; rel: string; href: string }
interface BreakdownRow { key: string; label: string; count: number; href: string | null }
interface RiskyUser { id: string; username: string; count: number; href: string }
interface TrendPoint { label: string; value: number }
interface ActivityPoint { label: string; content: number; reports: number }
interface ScanSummary { allow: number; review: number; block: number; blockRate: number; topTerms: { term: string; count: number }[] }
interface AuditItem { actor: string; actionLabel: string; entityLabel: string; reason: string | null; rel: string }
interface TopUniversity { domain: string; name: string; total: number; href: string }
interface TopCommunity { name: string; members: number; university: string | null }
interface Payload {
  kpis: Kpi[]
  reportQueue: QueueItem[]
  flaggedContent: FlaggedItem[]
  appealQueue: AppealItem[]
  opsQueue: OpsItem[]
  reportsByReason: BreakdownRow[]
  reportsByTarget: BreakdownRow[]
  activeSanctions: BreakdownRow[]
  signupTrend: TrendPoint[]
  activityTrend: ActivityPoint[]
  topUniversities: TopUniversity[]
  topCommunities: TopCommunity[]
  riskyUsers: RiskyUser[]
  scanSummary: ScanSummary
  recentActions: AuditItem[]
  generatedAt: string
}

const api = new ApiClient()

// This component bundles for the browser; the admin tsconfig has no DOM lib, so
// reach `document` through globalThis (same pattern as hub.tsx with location).
const doc = (globalThis as {
  document?: {
    visibilityState?: string
    addEventListener?: (type: string, handler: () => void) => void
    removeEventListener?: (type: string, handler: () => void) => void
  }
}).document
const isVisible = (): boolean => (doc?.visibilityState ?? 'visible') === 'visible'

// Single palette source — the @adminjs/design-system theme doesn't expose these
// exact tokens to inline styles, so they're centralized here instead of scattered.
const COLORS = {
  ink: '#1C1C28',
  body: '#454655',
  muted: '#6B6B7B',
  line: '#F0F0F4',
  skel: '#EEEFF5',
  blue: '#4268F6',
  green: '#32A887',
  amber: '#E0A800',
  red: '#FF4567',
  orange: '#FF8A4C',
}

// tone → design-system color token (Icon/Text) + raw hex (big number).
const TONE_COLOR: Record<Tone, string> = { ok: 'success', warn: 'warning', crit: 'error' }
const TONE_HEX: Record<Tone, string> = { ok: COLORS.green, warn: COLORS.amber, crit: COLORS.red }
// Non-color urgency cue so warn/crit is distinguishable without relying on color
// alone (WCAG 1.4.1): a left accent border + an icon + a word label.
const TONE_NOTE: Record<Tone, string | null> = { ok: null, warn: 'Dikkat', crit: 'Acil' }

const CARD_STYLE: React.CSSProperties = { flex: '1 1 230px', minWidth: 200 }
const BORDER = `1px solid ${COLORS.line}`

// All wall-clock display is pinned to Europe/Istanbul so the greeting + "son
// güncelleme" clock line up with the SQL day-boundaries (also Istanbul-anchored
// in stats.ts). A moderator on a non-TR browser would otherwise see a clock and
// salutation that contradict the Istanbul-based "bugün" KPI counts.
const TZ = 'Europe/Istanbul'

function istanbulHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(d),
  )
}

function greeting(): string {
  const h = istanbulHour(new Date())
  if (h < 6) return 'İyi geceler'
  if (h < 12) return 'Günaydın'
  if (h < 18) return 'İyi günler'
  return 'İyi akşamlar'
}

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ,
  }).format(new Date(iso))
}

// ---- KPI card -----------------------------------------------------------
const KpiCard: React.FC<{ kpi: Kpi }> = ({ kpi }) => {
  const showDelta = kpi.delta !== null && kpi.delta !== 0
  const up = (kpi.delta ?? 0) > 0
  const note = TONE_NOTE[kpi.tone]
  return (
    <a
      href={kpi.href}
      className="ek-link"
      aria-label={`${kpi.label}: ${kpi.value}${note ? ` — ${note}` : ''}`}
      style={{ textDecoration: 'none', ...CARD_STYLE }}
    >
      <Box
        bg="white"
        boxShadow="card"
        borderRadius={12}
        p="lg"
        style={{ cursor: 'pointer', height: '100%', borderLeft: note ? `3px solid ${TONE_HEX[kpi.tone]}` : undefined }}
      >
        <Box flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 10 }}>
          <H5 style={{ margin: 0, color: COLORS.muted }}>{kpi.label}</H5>
          <Icon icon={kpi.icon} size={18} color={TONE_COLOR[kpi.tone]} />
        </Box>
        <Box flex alignItems="baseline" style={{ gap: 8 }}>
          <Text style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: TONE_HEX[kpi.tone] }}>{kpi.value}</Text>
          {note && (
            <Box flex alignItems="center" style={{ gap: 2 }}>
              <Icon icon="AlertCircle" size={12} color={TONE_COLOR[kpi.tone]} />
              <Text style={{ margin: 0, fontSize: 11, fontWeight: 600, color: TONE_HEX[kpi.tone] }}>{note}</Text>
            </Box>
          )}
          {showDelta && (
            <Box flex alignItems="center" style={{ gap: 2 }}>
              <Icon icon={up ? 'TrendingUp' : 'TrendingDown'} size={14} color={up ? 'success' : 'error'} />
              <Text style={{ margin: 0, fontSize: 13, color: up ? COLORS.green : COLORS.red }}>
                {up ? '+' : ''}{kpi.delta}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    </a>
  )
}

// ---- sparkline (14 vertical CSS bars; divide-by-zero guarded) -----------
const Sparkline: React.FC<{ points: TrendPoint[] }> = ({ points }) => {
  const max = points.length ? Math.max(...points.map((p) => p.value)) : 0
  return (
    <Box flex alignItems="flex-end" justifyContent="space-between" style={{ gap: 3, height: 56 }}>
      {points.map((p, i) => {
        const h = max > 0 ? Math.max(3, Math.round((p.value / max) * 50)) : 3
        return (
          <Box
            key={`${p.label}-${i}`}
            style={{ flexGrow: 1, height: h, backgroundColor: COLORS.blue, borderRadius: 2, minWidth: 4, opacity: 0.85 }}
          />
        )
      })}
    </Box>
  )
}

// ---- generic section card -----------------------------------------------
const SectionCard: React.FC<{ title: string; icon: string; children: React.ReactNode; style?: React.CSSProperties }> = ({
  title, icon, children, style,
}) => (
  <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ flex: '1 1 420px', minWidth: 320, ...style }}>
    <Box flex alignItems="center" style={{ gap: 8, marginBottom: 14 }}>
      <Icon icon={icon} size={18} color="grey60" />
      <H4 style={{ margin: 0 }}>{title}</H4>
    </Box>
    {children}
  </Box>
)

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <Box flex alignItems="center" style={{ flexDirection: 'column', padding: '28px 0' }}>
    <Icon icon="Inbox" size={28} color="grey40" />
    <Text color="grey60" style={{ marginTop: 8 }}>{text}</Text>
  </Box>
)

// P0/P1 = red, P2 = amber, P3 = grey.
const SEV_HEX: Record<string, string> = { P0: COLORS.red, P1: COLORS.red, P2: COLORS.amber, P3: COLORS.muted }
const SEV_VARIANT: Record<string, 'danger' | 'secondary' | 'default'> = { P0: 'danger', P1: 'danger', P2: 'secondary', P3: 'default' }

// ---- horizontal proportional bar (breakdowns) ---------------------------
const BarRow: React.FC<{ row: BreakdownRow; max: number; color?: string }> = ({ row, max, color }) => {
  const pct = max > 0 ? Math.max(4, Math.round((row.count / max) * 100)) : 0
  const inner = (
    <Box style={{ padding: '6px 0' }}>
      <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8, marginBottom: 4 }}>
        <Text style={{ margin: 0, color: COLORS.body, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</Text>
        <Text style={{ margin: 0, color: COLORS.ink, fontSize: 13, fontWeight: 600 }}>{row.count}</Text>
      </Box>
      <Box style={{ height: 6, borderRadius: 3, backgroundColor: COLORS.skel }}>
        <Box style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: color ?? COLORS.blue }} />
      </Box>
    </Box>
  )
  return row.href
    ? <a href={row.href} className="ek-link" style={{ textDecoration: 'none', display: 'block' }}>{inner}</a>
    : inner
}

// ---- two-series mini bars (content vs reports) --------------------------
const DualSpark: React.FC<{ points: ActivityPoint[] }> = ({ points }) => {
  const max = points.length ? Math.max(1, ...points.map((p) => Math.max(p.content, p.reports))) : 1
  return (
    <Box flex alignItems="flex-end" justifyContent="space-between" style={{ gap: 4, height: 56 }}>
      {points.map((p, i) => (
        <Box key={`${p.label}-${i}`} flex alignItems="flex-end" style={{ flexGrow: 1, gap: 1, height: '100%' }}>
          <Box style={{ flex: 1, height: Math.max(2, Math.round((p.content / max) * 50)), backgroundColor: COLORS.blue, borderRadius: 2, opacity: 0.85 }} />
          <Box style={{ flex: 1, height: Math.max(2, Math.round((p.reports / max) * 50)), backgroundColor: COLORS.red, borderRadius: 2, opacity: 0.85 }} />
        </Box>
      ))}
    </Box>
  )
}

// ---- Box-based loading skeleton (no extra imports) ----------------------
const SkelBar: React.FC<{ w: number | string; h: number; mt?: number }> = ({ w, h, mt }) => (
  <Box style={{ width: w, height: h, marginTop: mt ?? 0, backgroundColor: COLORS.skel, borderRadius: 4 }} />
)

const Skeleton: React.FC = () => (
  <>
    <Box flex flexWrap="wrap" style={{ gap: 16, marginBottom: 24 }}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <Box key={i} bg="white" boxShadow="card" borderRadius={12} p="lg" style={CARD_STYLE}>
          <SkelBar w={120} h={14} />
          <SkelBar w={70} h={28} mt={12} />
        </Box>
      ))}
    </Box>
    <Box flex flexWrap="wrap" style={{ gap: 16 }}>
      {[0, 1].map((i) => (
        <Box key={i} bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ flex: '1 1 420px', minWidth: 320 }}>
          <SkelBar w={160} h={16} />
          {[0, 1, 2, 3].map((j) => <SkelBar key={j} w="100%" h={12} mt={12} />)}
        </Box>
      ))}
    </Box>
  </>
)

// ---- main ---------------------------------------------------------------
const Dashboard: React.FC = () => {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback((isManual: boolean) => {
    if (isManual) setRefreshing(true)
    api
      .getDashboard({ params: { _: Date.now() } }) // cache-buster
      // On success clear any prior error; on failure DON'T null out `data` —
      // keep the last good values visible and surface the error as a banner.
      .then((res) => { setData(res.data as Payload); setError(null) })
      .catch(() => setError('error'))
      .finally(() => { if (isManual) setRefreshing(false) })
  }, [])

  // Initial load + silent 30s polling so the moderation queues never go stale
  // behind an open tab. Skip the tick when the tab is hidden (no wasted query)
  // and refetch immediately when it becomes visible again.
  useEffect(() => {
    load(false)
    const tick = (): void => { if (isVisible()) load(false) }
    const id = setInterval(tick, 30000)
    doc?.addEventListener?.('visibilitychange', tick)
    return () => { clearInterval(id); doc?.removeEventListener?.('visibilitychange', tick) }
  }, [load])

  return (
    <Box variant="grey" style={{ minHeight: '100%' }}>
      {/* Keyboard focus ring + row hover — inline styles can't express :focus-visible/:hover. */}
      <style>{`
        .ek-link:focus-visible { outline: 2px solid #4268F6; outline-offset: 2px; border-radius: 8px; }
        .ek-row:hover { background: #F7F7FB; }
      `}</style>
      {/* header: greeting + last-updated + Yenile */}
      <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ marginBottom: 24 }}>
        <Box flex flexWrap="wrap" alignItems="center" justifyContent="space-between" style={{ gap: 12 }}>
          <Box>
            <H2 style={{ margin: 0 }}>{greeting()}, moderatör</H2>
            <Text color="grey60">Moderasyon kokpiti — dikkat gerektirenler renkli işaretli.</Text>
          </Box>
          <Box flex alignItems="center" style={{ gap: 12 }}>
            {data && (
              <Box flex alignItems="center" style={{ gap: 4 }}>
                <Icon icon="Clock" size={14} color="grey60" />
                <Text color="grey60" style={{ margin: 0, fontSize: 13 }}>Son güncelleme {fmtTime(data.generatedAt)}</Text>
              </Box>
            )}
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              aria-busy={refreshing}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                cursor: refreshing ? 'default' : 'pointer', padding: '6px 12px',
                background: 'white', border: '1px solid #E4E4EB', borderRadius: 8,
                font: 'inherit', opacity: refreshing ? 0.6 : 1,
              }}
            >
              <Icon icon="RefreshCw" size={14} color="grey100" />
              <Text style={{ margin: 0, color: COLORS.ink }}>{refreshing ? 'Yenileniyor' : 'Yenile'}</Text>
            </button>
          </Box>
        </Box>
      </Box>

      {error && (
        <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ marginBottom: 24 }}>
          <Box flex flexWrap="wrap" alignItems="center" justifyContent="space-between" style={{ gap: 8 }}>
            <Box flex alignItems="center" style={{ gap: 8 }}>
              <Icon icon="AlertTriangle" size={18} color="error" />
              <Text style={{ margin: 0 }}>
                {data
                  ? 'Yenilenemedi — gösterilen veriler güncel olmayabilir.'
                  : 'Panel verileri yüklenemedi.'}
              </Text>
            </Box>
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              style={{
                cursor: refreshing ? 'default' : 'pointer', padding: '6px 12px',
                background: 'white', border: '1px solid #E4E4EB', borderRadius: 8,
                font: 'inherit', opacity: refreshing ? 0.6 : 1,
              }}
            >
              <Text style={{ margin: 0, color: COLORS.ink }}>Tekrar dene</Text>
            </button>
          </Box>
        </Box>
      )}

      {!data && !error && <Skeleton />}

      {data && (
        <>
          {/* KPI grid */}
          <Box flex flexWrap="wrap" style={{ gap: 16, marginBottom: 24 }}>
            {data.kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} />)}
          </Box>

          {/* report queue + flagged content */}
          <Box flex flexWrap="wrap" style={{ gap: 16, marginBottom: 24 }}>
            <SectionCard title="Şikayet Kuyruğu" icon="Flag">
              {data.reportQueue.length === 0 ? (
                <EmptyState text="Bekleyen şikayet yok." />
              ) : (
                data.reportQueue.map((item) => (
                  <a key={item.id} href={item.href} className="ek-link" aria-label={`Şikayet: ${item.targetLabel} — ${item.reason}`} style={{ textDecoration: 'none' }}>
                    <Box className="ek-row" flex alignItems="center" justifyContent="space-between" style={{ gap: 10, padding: '8px 0', borderBottom: BORDER, cursor: 'pointer' }}>
                      <Box flex alignItems="center" style={{ gap: 8, minWidth: 0 }}>
                        <Badge variant="primary">{item.targetLabel}</Badge>
                        <Text style={{ margin: 0, flex: '1 1 auto', minWidth: 0, color: COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.reason}</Text>
                      </Box>
                      <Box flex alignItems="center" style={{ gap: 8, flexShrink: 0 }}>
                        <Text color="grey60" style={{ margin: 0, fontSize: 12 }}>{item.rel}</Text>
                        <Icon icon="ChevronRight" size={16} color="grey40" />
                      </Box>
                    </Box>
                  </a>
                ))
              )}
            </SectionCard>

            <SectionCard title="İşaretli İçerik" icon="AlertTriangle">
              {data.flaggedContent.length === 0 ? (
                <EmptyState text="İşaretli içerik yok." />
              ) : (
                data.flaggedContent.map((item) => (
                  <a key={`${item.source}-${item.id}`} href={item.href} className="ek-link" aria-label={`${item.sourceLabel}: ${item.snippet || '(boş)'}`} style={{ textDecoration: 'none' }}>
                    <Box className="ek-row" style={{ padding: '8px 0', borderBottom: BORDER, cursor: 'pointer' }}>
                      <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8 }}>
                        <Box flex alignItems="center" style={{ gap: 6, minWidth: 0 }}>
                          <Badge variant={item.source === 'note' ? 'success' : item.source === 'comment' ? 'secondary' : 'primary'}>{item.sourceLabel}</Badge>
                          <Badge variant={item.flagKind === 'auto' ? 'info' : 'default'}>{item.flagKind === 'auto' ? 'Oto' : 'Şikayet'}</Badge>
                          {item.label && <Text color="grey60" style={{ margin: 0, fontSize: 11 }}>{item.label}</Text>}
                        </Box>
                        <Text color="grey60" style={{ margin: 0, fontSize: 12 }}>{item.rel}</Text>
                      </Box>
                      <Text
                        title={item.snippet || ''}
                        style={{ margin: '6px 0 0', color: COLORS.body, fontSize: 13, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {item.snippet || '(boş)'}
                      </Text>
                      {item.university && <Text color="grey60" style={{ margin: '2px 0 0', fontSize: 11 }}>{item.university}</Text>}
                    </Box>
                  </a>
                ))
              )}
            </SectionCard>
          </Box>

          {/* appeal queue + ops queue */}
          <Box flex flexWrap="wrap" style={{ gap: 16, marginBottom: 24 }}>
            <SectionCard title="İtiraz Kuyruğu" icon="Inbox">
              {data.appealQueue.length === 0 ? (
                <EmptyState text="Bekleyen itiraz yok." />
              ) : (
                data.appealQueue.map((item) => (
                  <a key={item.id} href={item.href} className="ek-link" aria-label={`İtiraz: ${item.typeLabel} — ${item.reason}`} style={{ textDecoration: 'none' }}>
                    <Box className="ek-row" flex alignItems="center" justifyContent="space-between" style={{ gap: 10, padding: '8px 0', borderBottom: BORDER, cursor: 'pointer' }}>
                      <Box flex alignItems="center" style={{ gap: 8, minWidth: 0 }}>
                        <Badge variant="secondary">{item.typeLabel}</Badge>
                        <Text style={{ margin: 0, flex: '1 1 auto', minWidth: 0, color: COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.reason}</Text>
                      </Box>
                      <Box flex alignItems="center" style={{ gap: 8, flexShrink: 0 }}>
                        <Text color="grey60" style={{ margin: 0, fontSize: 12 }}>{item.rel}</Text>
                        <Icon icon="ChevronRight" size={16} color="grey40" />
                      </Box>
                    </Box>
                  </a>
                ))
              )}
            </SectionCard>

            <SectionCard title="İş Kuyruğu (Ops)" icon="List">
              {data.opsQueue.length === 0 ? (
                <EmptyState text="Açık iş yok." />
              ) : (
                data.opsQueue.map((item) => (
                  <a key={item.id} href={item.href} className="ek-link" aria-label={`${item.domainLabel}: ${item.title}`} style={{ textDecoration: 'none' }}>
                    <Box className="ek-row" flex alignItems="center" justifyContent="space-between" style={{ gap: 10, padding: '8px 0', borderBottom: BORDER, cursor: 'pointer' }}>
                      <Box flex alignItems="center" style={{ gap: 8, minWidth: 0 }}>
                        <Badge variant={SEV_VARIANT[item.severity] ?? 'default'}>{item.severity}</Badge>
                        <Text style={{ margin: 0, flex: '1 1 auto', minWidth: 0, color: COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</Text>
                      </Box>
                      <Box flex alignItems="center" style={{ gap: 8, flexShrink: 0 }}>
                        {!item.owned && <Badge variant="default">Atanmamış</Badge>}
                        {item.due && (
                          <Text style={{ margin: 0, fontSize: 12, color: item.due.overdue ? COLORS.red : COLORS.muted }}>{item.due.text}</Text>
                        )}
                        <Icon icon="ChevronRight" size={16} color="grey40" />
                      </Box>
                    </Box>
                  </a>
                ))
              )}
            </SectionCard>
          </Box>

          {/* reports breakdown + active sanctions */}
          <Box flex flexWrap="wrap" style={{ gap: 16, marginBottom: 24 }}>
            <SectionCard title="Şikayet Dağılımı" icon="PieChart">
              {data.reportsByReason.length === 0 && data.reportsByTarget.length === 0 ? (
                <EmptyState text="Açık şikayet yok." />
              ) : (
                <>
                  {data.reportsByTarget.length > 0 && (
                    <Box flex flexWrap="wrap" style={{ gap: 6, marginBottom: 12 }}>
                      {data.reportsByTarget.map((t) => (
                        t.href ? (
                          <a key={t.key} href={t.href} className="ek-link" style={{ textDecoration: 'none' }}>
                            <Box flex alignItems="center" style={{ gap: 6, padding: '4px 8px', border: BORDER, borderRadius: 8 }}>
                              <Text style={{ margin: 0, color: COLORS.ink, fontSize: 12 }}>{t.label}</Text>
                              <Badge variant="primary">{t.count}</Badge>
                            </Box>
                          </a>
                        ) : (
                          <Box key={t.key} flex alignItems="center" style={{ gap: 6, padding: '4px 8px', border: BORDER, borderRadius: 8 }}>
                            <Text style={{ margin: 0, color: COLORS.ink, fontSize: 12 }}>{t.label}</Text>
                            <Badge variant="primary">{t.count}</Badge>
                          </Box>
                        )
                      ))}
                    </Box>
                  )}
                  {data.reportsByReason.map((r) => (
                    <BarRow key={r.key} row={r} max={data.reportsByReason[0]?.count ?? 0} color="#FF8A4C" />
                  ))}
                </>
              )}
            </SectionCard>

            <SectionCard title="Aktif Yaptırımlar" icon="Slash" style={{ flex: '1 1 300px', minWidth: 260 }}>
              {data.activeSanctions.length === 0 ? (
                <EmptyState text="Aktif yaptırım yok." />
              ) : (
                data.activeSanctions.map((s) => (
                  <BarRow key={s.key} row={s} max={data.activeSanctions[0]?.count ?? 0} color="#FF4567" />
                ))
              )}
            </SectionCard>
          </Box>

          {/* sparkline + top universities + top communities */}
          <Box flex flexWrap="wrap" style={{ gap: 16 }}>
            <SectionCard title="Son 14 Gün Kayıt" icon="TrendingUp" style={{ flex: '1 1 360px' }}>
              {data.signupTrend.every((p) => p.value === 0) ? (
                <EmptyState text="Son 14 günde kayıt yok." />
              ) : (
                <>
                  <Sparkline points={data.signupTrend} />
                  <Box flex justifyContent="space-between" style={{ marginTop: 6 }}>
                    <Text color="grey60" style={{ margin: 0, fontSize: 11 }}>{data.signupTrend[0]?.label ?? ''}</Text>
                    <Text color="grey60" style={{ margin: 0, fontSize: 11 }}>{data.signupTrend[data.signupTrend.length - 1]?.label ?? ''}</Text>
                  </Box>
                </>
              )}
            </SectionCard>

            <SectionCard title="En Aktif Üniversiteler" icon="Award" style={{ flex: '1 1 300px', minWidth: 260 }}>
              {data.topUniversities.length === 0 ? (
                <EmptyState text="Veri yok." />
              ) : (
                data.topUniversities.map((u) => (
                  <a key={u.domain} href={u.href} className="ek-link" aria-label={`${u.name}: ${u.total}`} style={{ textDecoration: 'none' }}>
                    <Box className="ek-row" flex alignItems="center" justifyContent="space-between" style={{ gap: 8, padding: '7px 0', borderBottom: BORDER, cursor: 'pointer' }}>
                      <Text style={{ margin: 0, flex: '1 1 auto', minWidth: 0, color: COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</Text>
                      <Badge variant="primary">{u.total}</Badge>
                    </Box>
                  </a>
                ))
              )}
            </SectionCard>

            <SectionCard title="En Büyük Topluluklar" icon="Users" style={{ flex: '1 1 300px', minWidth: 260 }}>
              {data.topCommunities.length === 0 ? (
                <EmptyState text="Veri yok." />
              ) : (
                data.topCommunities.map((c, i) => (
                  <Box key={`${c.name}-${i}`} flex alignItems="center" justifyContent="space-between" style={{ gap: 8, padding: '7px 0', borderBottom: BORDER }}>
                    <Box style={{ minWidth: 0 }}>
                      <Text style={{ margin: 0, color: COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Text>
                      {c.university && <Text color="grey60" style={{ margin: 0, fontSize: 11 }}>{c.university}</Text>}
                    </Box>
                    <Box flex alignItems="center" style={{ gap: 4, flexShrink: 0 }}>
                      <Icon icon="Users" size={13} color="grey60" />
                      <Text color="grey60" style={{ margin: 0, fontSize: 13 }}>{c.members}</Text>
                    </Box>
                  </Box>
                ))
              )}
            </SectionCard>
          </Box>

          {/* activity trend + risky users */}
          <Box flex flexWrap="wrap" style={{ gap: 16, marginTop: 24 }}>
            <SectionCard title="İçerik & Şikayet (14g)" icon="BarChart2" style={{ flex: '1 1 360px' }}>
              {data.activityTrend.every((p) => p.content === 0 && p.reports === 0) ? (
                <EmptyState text="Son 14 günde aktivite yok." />
              ) : (
                <>
                  <DualSpark points={data.activityTrend} />
                  <Box flex alignItems="center" style={{ gap: 14, marginTop: 8 }}>
                    <Box flex alignItems="center" style={{ gap: 4 }}>
                      <Box style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.blue }} />
                      <Text color="grey60" style={{ margin: 0, fontSize: 11 }}>İçerik</Text>
                    </Box>
                    <Box flex alignItems="center" style={{ gap: 4 }}>
                      <Box style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.red }} />
                      <Text color="grey60" style={{ margin: 0, fontSize: 11 }}>Şikayet</Text>
                    </Box>
                  </Box>
                </>
              )}
            </SectionCard>

            <SectionCard title="Riskli Kullanıcılar" icon="UserX" style={{ flex: '1 1 300px', minWidth: 260 }}>
              {data.riskyUsers.length === 0 ? (
                <EmptyState text="Açık şikayeti olan kullanıcı yok." />
              ) : (
                data.riskyUsers.map((u) => (
                  <a key={u.id} href={u.href} className="ek-link" aria-label={`${u.username}: ${u.count} şikayet`} style={{ textDecoration: 'none' }}>
                    <Box className="ek-row" flex alignItems="center" justifyContent="space-between" style={{ gap: 8, padding: '7px 0', borderBottom: BORDER, cursor: 'pointer' }}>
                      <Text style={{ margin: 0, flex: '1 1 auto', minWidth: 0, color: COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</Text>
                      <Badge variant="danger">{u.count}</Badge>
                    </Box>
                  </a>
                ))
              )}
            </SectionCard>
          </Box>

          {/* auto-moderation health + recent admin actions */}
          <Box flex flexWrap="wrap" style={{ gap: 16, marginTop: 24 }}>
            <SectionCard title="Oto-Moderasyon (bugün)" icon="Shield" style={{ flex: '1 1 360px' }}>
              {(data.scanSummary.allow + data.scanSummary.review + data.scanSummary.block) === 0 ? (
                <EmptyState text="Bugün tarama kaydı yok." />
              ) : (
                <>
                  <Box flex flexWrap="wrap" style={{ gap: 20, marginBottom: 12 }}>
                    <Box>
                      <Text color="grey60" style={{ margin: 0, fontSize: 12 }}>Blok Oranı</Text>
                      <Text style={{ margin: 0, fontSize: 24, fontWeight: 700, color: data.scanSummary.blockRate >= 20 ? COLORS.red : COLORS.ink }}>%{data.scanSummary.blockRate}</Text>
                    </Box>
                    <Box>
                      <Text color="grey60" style={{ margin: 0, fontSize: 12 }}>İzin</Text>
                      <Text style={{ margin: 0, fontSize: 24, fontWeight: 700, color: COLORS.green }}>{data.scanSummary.allow}</Text>
                    </Box>
                    <Box>
                      <Text color="grey60" style={{ margin: 0, fontSize: 12 }}>İncele</Text>
                      <Text style={{ margin: 0, fontSize: 24, fontWeight: 700, color: COLORS.amber }}>{data.scanSummary.review}</Text>
                    </Box>
                    <Box>
                      <Text color="grey60" style={{ margin: 0, fontSize: 12 }}>Blok</Text>
                      <Text style={{ margin: 0, fontSize: 24, fontWeight: 700, color: COLORS.red }}>{data.scanSummary.block}</Text>
                    </Box>
                  </Box>
                  {data.scanSummary.topTerms.length > 0 && (
                    <Box flex flexWrap="wrap" style={{ gap: 6 }}>
                      {data.scanSummary.topTerms.map((t) => (
                        <Box key={t.term} flex alignItems="center" style={{ gap: 6, padding: '4px 8px', border: BORDER, borderRadius: 8 }}>
                          <Text style={{ margin: 0, color: COLORS.body, fontSize: 12 }}>{t.term}</Text>
                          <Badge variant="default">{t.count}</Badge>
                        </Box>
                      ))}
                    </Box>
                  )}
                </>
              )}
            </SectionCard>

            <SectionCard title="Son Yönetici Aksiyonları" icon="Activity" style={{ flex: '1 1 360px' }}>
              {data.recentActions.length === 0 ? (
                <EmptyState text="Kayıtlı aksiyon yok." />
              ) : (
                data.recentActions.map((a, i) => (
                  <Box key={i} flex alignItems="center" justifyContent="space-between" style={{ gap: 8, padding: '7px 0', borderBottom: BORDER }}>
                    <Text style={{ margin: 0, minWidth: 0, color: COLORS.body, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <b style={{ color: COLORS.ink }}>{a.actor}</b> {a.entityLabel} {a.actionLabel}
                    </Text>
                    <Text color="grey60" style={{ margin: 0, fontSize: 12, flexShrink: 0 }}>{a.rel}</Text>
                  </Box>
                ))
              )}
            </SectionCard>
          </Box>
        </>
      )}
    </Box>
  )
}

export default Dashboard
