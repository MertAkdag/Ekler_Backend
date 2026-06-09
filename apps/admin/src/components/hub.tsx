import React, { useEffect, useState } from 'react'
import { ApiClient } from 'adminjs'
import { Badge, Box, H2, H4, Loader, Text } from '@adminjs/design-system'

/** Mirror of HubPayload from hubs.ts (the handler's return shape). */
interface HubChip {
  label: string
  count: number
  href: string
}
interface HubRow {
  id: string
  label: string
  sublabel?: string
  chips: HubChip[]
}
interface HubPayload {
  title: string
  rows: HubRow[]
}

const api = new ApiClient()

/** Page URL is <rootPath>/pages/<pageName> → the page key is the last path segment. */
function currentPageName(): string {
  // This component bundles for the browser; type via globalThis to avoid needing the DOM lib.
  const loc = (globalThis as { location?: { pathname?: string } }).location
  const parts = (loc?.pathname ?? '').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

const Chip: React.FC<{ chip: HubChip }> = ({ chip }) => (
  // Plain <a> = full reload, but guaranteed to apply the filter (the list rebuilds
  // its query from location.search). Safest for a blind build.
  <a href={chip.href} style={{ textDecoration: 'none' }}>
    <Box
      flex
      alignItems="center"
      style={{ gap: 6, padding: '6px 10px', border: '1px solid #E4E4EB', borderRadius: 8, cursor: 'pointer' }}
    >
      <Text style={{ margin: 0, color: '#1C1C28' }}>{chip.label}</Text>
      <Badge variant={chip.count > 0 ? 'primary' : 'default'}>{chip.count}</Badge>
    </Box>
  </a>
)

const HubCard: React.FC<{ row: HubRow }> = ({ row }) => (
  <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ marginBottom: 16 }}>
    <H4 style={{ margin: 0 }}>{row.label}</H4>
    {row.sublabel && (
      <Text color="grey60" style={{ marginBottom: 10 }}>
        {row.sublabel}
      </Text>
    )}
    <Box flex flexWrap="wrap" style={{ gap: 8, marginTop: row.sublabel ? 0 : 10 }}>
      {row.chips.map((chip) => (
        <Chip key={chip.label} chip={chip} />
      ))}
    </Box>
  </Box>
)

const Hub: React.FC = () => {
  // INVARIANT: pageName is recomputed every render and the effect is keyed on it,
  // so switching between hub pages in the SPA refetches. Do NOT memoize pageName
  // (useState/useRef) or drop the [pageName] dep — that would show hub A's data on
  // hub B.
  const pageName = currentPageName()
  const [data, setData] = useState<HubPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    api
      .getPage({ pageName })
      .then((res) => setData(res.data as HubPayload))
      .catch(() => setError('Veriler yüklenemedi.'))
  }, [pageName])

  return (
    <Box variant="grey" style={{ minHeight: '100%' }}>
      <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ marginBottom: 24 }}>
        <H2 style={{ margin: 0 }}>{data?.title ?? 'Genel Bakış'}</H2>
        <Text color="grey60">Bir değere tıklayarak ilgili filtrelenmiş listeyi aç.</Text>
      </Box>

      {error && (
        <Box bg="white" boxShadow="card" borderRadius={12} p="lg">
          <Text>{error}</Text>
        </Box>
      )}
      {!data && !error && <Loader />}
      {data && data.rows.length === 0 && (
        <Box bg="white" boxShadow="card" borderRadius={12} p="lg">
          <Text>Kayıt yok.</Text>
        </Box>
      )}
      {data && data.rows.map((row) => <HubCard key={row.id} row={row} />)}
    </Box>
  )
}

export default Hub
