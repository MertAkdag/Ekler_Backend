import React, { useCallback, useEffect, useState } from 'react'
import { ApiClient } from 'adminjs'
import { Badge, Box, H2, H4, H5, Icon, Text } from '@adminjs/design-system'

// ---- payload mirror (must match DashboardPayload in stats.ts) -----------
type Tone = 'ok' | 'warn' | 'crit'
interface Kpi { key: string; label: string; value: number; delta: number | null; href: string; icon: string; tone: Tone }
interface QueueItem { id: string; targetType: string; targetLabel: string; reason: string; rel: string; href: string }
interface FlaggedItem { id: string; source: string; sourceLabel: string; snippet: string; university: string | null; rel: string; href: string }
interface TrendPoint { label: string; value: number }
interface TopUniversity { domain: string; name: string; total: number; href: string }
interface TopCommunity { name: string; members: number; university: string | null }
interface Payload {
  kpis: Kpi[]
  reportQueue: QueueItem[]
  flaggedContent: FlaggedItem[]
  signupTrend: TrendPoint[]
  topUniversities: TopUniversity[]
  topCommunities: TopCommunity[]
  generatedAt: string
}

const api = new ApiClient()

// tone → design-system color token (Icon/Text) + raw hex (big number).
const TONE_COLOR: Record<Tone, string> = { ok: 'success', warn: 'warning', crit: 'error' }
const TONE_HEX: Record<Tone, string> = { ok: '#32A887', warn: '#E0A800', crit: '#FF4567' }

const CARD_STYLE: React.CSSProperties = { flex: '1 1 230px', minWidth: 200 }
const BORDER = '1px solid #F0F0F4'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'İyi geceler'
  if (h < 12) return 'Günaydın'
  if (h < 18) return 'İyi günler'
  return 'İyi akşamlar'
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---- KPI card -----------------------------------------------------------
const KpiCard: React.FC<{ kpi: Kpi }> = ({ kpi }) => {
  const showDelta = kpi.delta !== null && kpi.delta !== 0
  const up = (kpi.delta ?? 0) > 0
  return (
    <a href={kpi.href} style={{ textDecoration: 'none', ...CARD_STYLE }}>
      <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ cursor: 'pointer', height: '100%' }}>
        <Box flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 10 }}>
          <H5 style={{ margin: 0, color: '#6B6B7B' }}>{kpi.label}</H5>
          <Icon icon={kpi.icon} size={18} color={TONE_COLOR[kpi.tone]} />
        </Box>
        <Box flex alignItems="baseline" style={{ gap: 8 }}>
          <Text style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: TONE_HEX[kpi.tone] }}>{kpi.value}</Text>
          {showDelta && (
            <Box flex alignItems="center" style={{ gap: 2 }}>
              <Icon icon={up ? 'TrendingUp' : 'TrendingDown'} size={14} color={up ? 'success' : 'error'} />
              <Text style={{ margin: 0, fontSize: 13, color: up ? '#32A887' : '#FF4567' }}>
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
            style={{ flexGrow: 1, height: h, backgroundColor: '#4268F6', borderRadius: 2, minWidth: 4, opacity: 0.85 }}
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

// ---- Box-based loading skeleton (no extra imports) ----------------------
const SkelBar: React.FC<{ w: number | string; h: number; mt?: number }> = ({ w, h, mt }) => (
  <Box style={{ width: w, height: h, marginTop: mt ?? 0, backgroundColor: '#EEEFF5', borderRadius: 4 }} />
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
    setError(null)
    api
      .getDashboard({ params: { _: Date.now() } }) // cache-buster
      .then((res) => setData(res.data as Payload))
      .catch(() => setError('Panel verileri yüklenemedi.'))
      .finally(() => { if (isManual) setRefreshing(false) })
  }, [])

  useEffect(() => { load(false) }, [load])

  return (
    <Box variant="grey" style={{ minHeight: '100%' }}>
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
            <a
              onClick={(e) => { e.preventDefault(); if (!refreshing) load(true) }}
              href="#"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none',
                cursor: refreshing ? 'default' : 'pointer', padding: '6px 12px',
                border: '1px solid #E4E4EB', borderRadius: 8, opacity: refreshing ? 0.6 : 1,
              }}
            >
              <Icon icon="RefreshCw" size={14} color="grey100" />
              <Text style={{ margin: 0, color: '#1C1C28' }}>{refreshing ? 'Yenileniyor' : 'Yenile'}</Text>
            </a>
          </Box>
        </Box>
      </Box>

      {error && (
        <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ marginBottom: 24 }}>
          <Box flex alignItems="center" style={{ gap: 8 }}>
            <Icon icon="AlertTriangle" size={18} color="error" />
            <Text style={{ margin: 0 }}>{error}</Text>
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
                  <a key={item.id} href={item.href} style={{ textDecoration: 'none' }}>
                    <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 10, padding: '8px 0', borderBottom: BORDER, cursor: 'pointer' }}>
                      <Box flex alignItems="center" style={{ gap: 8, minWidth: 0 }}>
                        <Badge variant="primary">{item.targetLabel}</Badge>
                        <Text style={{ margin: 0, flex: '1 1 auto', minWidth: 0, color: '#1C1C28', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.reason}</Text>
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
                  <a key={`${item.source}-${item.id}`} href={item.href} style={{ textDecoration: 'none' }}>
                    <Box style={{ padding: '8px 0', borderBottom: BORDER, cursor: 'pointer' }}>
                      <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8 }}>
                        <Badge variant={item.source === 'comment' ? 'secondary' : 'primary'}>{item.sourceLabel}</Badge>
                        <Text color="grey60" style={{ margin: 0, fontSize: 12 }}>{item.rel}</Text>
                      </Box>
                      <Text style={{ margin: '6px 0 0', maxWidth: '100%', color: '#454655', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.snippet || '(boş)'}
                      </Text>
                      {item.university && <Text color="grey60" style={{ margin: '2px 0 0', fontSize: 11 }}>{item.university}</Text>}
                    </Box>
                  </a>
                ))
              )}
            </SectionCard>
          </Box>

          {/* sparkline + top universities + top communities */}
          <Box flex flexWrap="wrap" style={{ gap: 16 }}>
            <SectionCard title="Son 14 Gün Kayıt" icon="TrendingUp" style={{ flex: '1 1 360px' }}>
              {data.signupTrend.length === 0 ? (
                <EmptyState text="Veri yok." />
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
                  <a key={u.domain} href={u.href} style={{ textDecoration: 'none' }}>
                    <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8, padding: '7px 0', borderBottom: BORDER, cursor: 'pointer' }}>
                      <Text style={{ margin: 0, flex: '1 1 auto', minWidth: 0, color: '#1C1C28', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</Text>
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
                      <Text style={{ margin: 0, color: '#1C1C28', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Text>
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
        </>
      )}
    </Box>
  )
}

export default Dashboard
