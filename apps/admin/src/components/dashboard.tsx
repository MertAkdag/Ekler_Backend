import React, { useEffect, useState } from 'react'
import { ApiClient } from 'adminjs'
import { Box, H2, H4, H5, Icon, Loader, Text } from '@adminjs/design-system'

/** Mirror of DashboardStats from stats.ts (the handler's return shape). */
interface Stats {
  pending_reports: number
  flagged_confessions: number
  flagged_comments: number
  flagged_notes: number
  signups_today: number
  total_users: number
  active_sessions: number
  pending_events: number
}

interface Card {
  key: keyof Stats
  label: string
  /** Highlight in red when non-zero (needs attention) and group under "Dikkat gerektirenler". */
  alert?: boolean
}

const CARDS: Card[] = [
  { key: 'pending_reports', label: 'Açık Şikayet', alert: true },
  { key: 'flagged_confessions', label: 'İşaretli İtiraf', alert: true },
  { key: 'flagged_comments', label: 'İşaretli Yorum', alert: true },
  { key: 'flagged_notes', label: 'İşaretli Not', alert: true },
  { key: 'pending_events', label: 'Bekleyen Etkinlik', alert: true },
  { key: 'signups_today', label: 'Bugünkü Kayıt' },
  { key: 'active_sessions', label: 'Aktif Seans' },
  { key: 'total_users', label: 'Toplam Kullanıcı' },
]

const api = new ApiClient()

const StatCard: React.FC<{ card: Card; value: number }> = ({ card, value }) => {
  const highlight = Boolean(card.alert) && value > 0
  return (
    <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ flex: '1 1 200px', minWidth: 180 }}>
      <Box flex alignItems="center" style={{ gap: 6, marginBottom: 8 }}>
        {highlight && <Icon icon="AlertCircle" size={16} color="error" />}
        <H5 style={{ margin: 0 }}>{card.label}</H5>
      </Box>
      <Text style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: highlight ? '#C01048' : '#1C1C28' }}>
        {value}
      </Text>
    </Box>
  )
}

const Group: React.FC<{ title: string; cards: Card[]; stats: Stats }> = ({ title, cards, stats }) => (
  <Box style={{ marginBottom: 32 }}>
    <H4 style={{ marginBottom: 12 }}>{title}</H4>
    <Box flex flexWrap="wrap" style={{ gap: 16 }}>
      {cards.map((card) => (
        <StatCard key={card.key} card={card} value={stats[card.key]} />
      ))}
    </Box>
  </Box>
)

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getDashboard()
      .then((res) => setStats((res.data as { stats: Stats }).stats))
      .catch(() => setError('İstatistikler yüklenemedi.'))
  }, [])

  return (
    <Box variant="grey" style={{ minHeight: '100%' }}>
      <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ marginBottom: 32 }}>
        <H2 style={{ margin: 0 }}>Ekler Yönetim</H2>
        <Text color="grey60">Moderasyon özeti — dikkat gerektiren işler kırmızı.</Text>
      </Box>

      {error && (
        <Box bg="white" boxShadow="card" borderRadius={12} p="lg">
          <Text>{error}</Text>
        </Box>
      )}
      {!stats && !error && <Loader />}

      {stats && (
        <>
          <Group title="Dikkat gerektirenler" cards={CARDS.filter((c) => c.alert)} stats={stats} />
          <Group title="Genel" cards={CARDS.filter((c) => !c.alert)} stats={stats} />
        </>
      )}
    </Box>
  )
}

export default Dashboard
