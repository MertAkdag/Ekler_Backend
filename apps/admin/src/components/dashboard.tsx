import React, { useEffect, useState } from 'react'
import { ApiClient } from 'adminjs'
import { Box, H2, H5, Loader, Text } from '@adminjs/design-system'

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
  /** Highlight in red when the value is non-zero (needs attention). */
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
      <Box variant="white" style={{ marginBottom: 24 }}>
        <H2>Ekler Yönetim</H2>
        <Text>Moderasyon özeti — dikkat gerektiren işler kırmızı.</Text>
      </Box>

      {error && (
        <Box variant="white">
          <Text>{error}</Text>
        </Box>
      )}
      {!stats && !error && <Loader />}

      {stats && (
        <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {CARDS.map((card) => {
            const value = stats[card.key]
            const highlight = Boolean(card.alert) && value > 0
            return (
              <Box
                key={card.key}
                variant="white"
                style={{ flex: '1 1 200px', minWidth: 180 }}
              >
                <H5 style={{ marginBottom: 8 }}>{card.label}</H5>
                <H2 style={{ color: highlight ? '#C01048' : undefined, margin: 0 }}>{value}</H2>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

export default Dashboard
