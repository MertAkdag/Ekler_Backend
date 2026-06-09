import React from 'react'
import type { ActionProps, RecordJSON } from 'adminjs'
import { Badge, Box, H4, Icon, Text } from '@adminjs/design-system'

/**
 * Generic sectioned SHOW body for record-heavy resources (events). Driven by a
 * per-resource SECTION config selected by resource.id; reads record.params and
 * formats per row type. Replaces ONLY the show body — the action header (Edit /
 * Delete / Onayla / Reddet) is rendered separately by AdminJS and survives.
 */

type RowType = 'text' | 'long' | 'date' | 'image' | 'badge' | 'link' | 'bool' | 'university'
interface Row {
  key: string
  label: string
  type: RowType
  badgeMap?: string
}
interface Section {
  title: string
  icon: string
  rows: Row[]
}

type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'info' | 'default'
const BADGE_MAPS: Record<string, Record<string, { variant: Variant; label: string }>> = {
  city_event_status: {
    draft: { variant: 'default', label: 'Taslak' },
    pending: { variant: 'info', label: 'Bekliyor' },
    approved: { variant: 'success', label: 'Onaylandı' },
    scheduled: { variant: 'info', label: 'Planlandı' },
    live: { variant: 'success', label: 'Canlı' },
    ended: { variant: 'default', label: 'Bitti' },
    archived: { variant: 'default', label: 'Arşiv' },
    rejected: { variant: 'danger', label: 'Reddedildi' },
  },
  submission_status: {
    pending: { variant: 'info', label: 'Bekliyor' },
    approved: { variant: 'success', label: 'Onaylandı' },
    rejected: { variant: 'danger', label: 'Reddedildi' },
  },
}

const BORDER = '1px solid #F0F0F4'

function fmtDateTime(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  const d = new Date(v as string)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
}

function isBoolTrue(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  return ['t', 'true', '1'].includes(String(v).trim().toLowerCase())
}

function refLabel(record: RecordJSON | undefined, key: string): string {
  const populated = record?.populated?.[key]
  if (populated?.title) return populated.title
  const raw = record?.params?.[key]
  if (raw === null || raw === undefined || raw === '') return '—'
  return String(raw)
}

const Dash: React.FC = () => (
  <Text as="span" color="grey60" style={{ margin: 0 }}>—</Text>
)

const ValueRow: React.FC<{ row: Row; record?: RecordJSON }> = ({ row, record }) => {
  const raw = record?.params?.[row.key]
  const empty = raw === null || raw === undefined || raw === ''

  let value: React.ReactNode

  switch (row.type) {
    case 'date':
      value = <Text style={{ margin: 0, color: '#1C1C28' }}>{fmtDateTime(raw)}</Text>
      break

    case 'image':
      value = empty ? (
        <Dash />
      ) : (
        <Box
          as="img"
          src={String(raw)}
          alt=""
          width={160}
          height={90}
          borderRadius={8}
          bg="grey20"
          style={{ objectFit: 'cover', display: 'block' }}
          onError={(e: React.SyntheticEvent) => {
            const t = e.currentTarget as unknown as { style?: { display?: string } }
            if (t?.style) t.style.display = 'none'
          }}
        />
      )
      break

    case 'badge': {
      if (empty) { value = <Dash />; break }
      const map = row.badgeMap ? BADGE_MAPS[row.badgeMap] : undefined
      const entry = map?.[String(raw)]
      value = entry ? <Badge variant={entry.variant}>{entry.label}</Badge> : <Badge variant="default">{String(raw)}</Badge>
      break
    }

    case 'bool':
      value = <Badge variant={isBoolTrue(raw) ? 'primary' : 'default'}>{isBoolTrue(raw) ? 'Evet' : 'Hayır'}</Badge>
      break

    case 'link': {
      if (empty) { value = <Dash />; break }
      const s = String(raw)
      value = /^https?:\/\//i.test(s) ? (
        <a href={s} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#4268F6', wordBreak: 'break-all' }}>{s}</a>
      ) : (
        <Text style={{ margin: 0, color: '#1C1C28', wordBreak: 'break-all' }}>{s}</Text>
      )
      break
    }

    case 'university':
      value = <Text style={{ margin: 0, color: '#1C1C28' }}>{refLabel(record, row.key)}</Text>
      break

    case 'long':
      value = empty ? <Dash /> : (
        <Text style={{ margin: 0, color: '#1C1C28', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(raw)}</Text>
      )
      break

    case 'text':
    default:
      value = <Text style={{ margin: 0, color: '#1C1C28', wordBreak: 'break-word' }}>{empty ? '—' : String(raw)}</Text>
      break
  }

  const stacked = row.type === 'long' || row.type === 'image'
  if (stacked) {
    return (
      <Box style={{ padding: '9px 0', borderBottom: BORDER }}>
        <Text color="grey60" style={{ margin: '0 0 6px', fontSize: 13 }}>{row.label}</Text>
        {value}
      </Box>
    )
  }
  return (
    <Box flex alignItems="baseline" justifyContent="space-between" style={{ gap: 16, padding: '8px 0', borderBottom: BORDER }}>
      <Text color="grey60" style={{ margin: 0, fontSize: 13, flexShrink: 0 }}>{row.label}</Text>
      <Box style={{ textAlign: 'right', minWidth: 0 }}>{value}</Box>
    </Box>
  )
}

const SectionCard: React.FC<{ section: Section; record?: RecordJSON }> = ({ section, record }) => (
  <Box bg="white" boxShadow="card" borderRadius={12} p="lg" style={{ flex: '1 1 420px', minWidth: 320, marginBottom: 16 }}>
    <Box flex alignItems="center" style={{ gap: 8, marginBottom: 12 }}>
      <Icon icon={section.icon} size={18} color="grey60" />
      <H4 style={{ margin: 0 }}>{section.title}</H4>
    </Box>
    {section.rows.map((row) => <ValueRow key={row.key} row={row} record={record} />)}
  </Box>
)

const SECTIONS: Record<string, Section[]> = {
  city_events: [
    { title: 'Kimlik', icon: 'Tag', rows: [
      { key: 'title', label: 'Başlık', type: 'text' },
      { key: 'category', label: 'Kategori', type: 'text' },
      { key: 'cover_url', label: 'Kapak', type: 'image' },
      { key: 'description', label: 'Açıklama', type: 'long' },
    ] },
    { title: 'Tarih & Mekan', icon: 'Calendar', rows: [
      { key: 'starts_at', label: 'Başlangıç', type: 'date' },
      { key: 'ends_at', label: 'Bitiş', type: 'date' },
      { key: 'city_id', label: 'Şehir', type: 'university' },
      { key: 'venue_name', label: 'Mekan', type: 'text' },
      { key: 'venue_address', label: 'Adres', type: 'long' },
    ] },
    { title: 'Organizatör & Bilet', icon: 'User', rows: [
      { key: 'organizer_name', label: 'Organizatör', type: 'text' },
      { key: 'organizer_instagram', label: 'Instagram', type: 'link' },
      { key: 'organizer_url', label: 'Web', type: 'link' },
      { key: 'ticket_url', label: 'Bilet', type: 'link' },
      { key: 'price_label', label: 'Fiyat', type: 'text' },
    ] },
    { title: 'Durum & Sponsorluk', icon: 'Award', rows: [
      { key: 'status', label: 'Durum', type: 'badge', badgeMap: 'city_event_status' },
      { key: 'is_sponsored', label: 'Sponsorlu', type: 'bool' },
      { key: 'sponsorship_tier', label: 'Sponsorluk Seviyesi', type: 'text' },
    ] },
    { title: 'Yönetim', icon: 'Settings', rows: [
      { key: 'admin_notes', label: 'Admin Notları', type: 'long' },
      { key: 'partner_id', label: 'Partner', type: 'university' },
      { key: 'source_submission_id', label: 'Kaynak Başvuru', type: 'text' },
      { key: 'created_at', label: 'Oluşturuldu', type: 'date' },
      { key: 'updated_at', label: 'Güncellendi', type: 'date' },
    ] },
  ],
  event_submissions: [
    { title: 'Kimlik', icon: 'Tag', rows: [
      { key: 'title', label: 'Başlık', type: 'text' },
      { key: 'cover_url', label: 'Kapak', type: 'image' },
      { key: 'description', label: 'Açıklama', type: 'long' },
    ] },
    { title: 'Tarih & Mekan', icon: 'Calendar', rows: [
      { key: 'starts_at', label: 'Başlangıç', type: 'date' },
      { key: 'ends_at', label: 'Bitiş', type: 'date' },
      { key: 'city_id', label: 'Şehir', type: 'university' },
      { key: 'venue_name', label: 'Mekan', type: 'text' },
      { key: 'venue_address', label: 'Adres', type: 'long' },
    ] },
    { title: 'Başvuran & İletişim', icon: 'User', rows: [
      { key: 'partner_name', label: 'Partner', type: 'text' },
      { key: 'contact_name', label: 'İletişim Kişisi', type: 'text' },
      { key: 'contact_email', label: 'E-posta', type: 'text' },
      { key: 'contact_phone', label: 'Telefon', type: 'text' },
      { key: 'organizer_instagram', label: 'Instagram', type: 'link' },
      { key: 'organizer_url', label: 'Web', type: 'link' },
    ] },
    { title: 'Bilet & Paket', icon: 'Tag', rows: [
      { key: 'ticket_url', label: 'Bilet', type: 'link' },
      { key: 'price_label', label: 'Fiyat', type: 'text' },
      { key: 'package_requested', label: 'İstenen Paket', type: 'text' },
    ] },
    { title: 'Durum & İnceleme', icon: 'CheckCircle', rows: [
      { key: 'status', label: 'Durum', type: 'badge', badgeMap: 'submission_status' },
      { key: 'submission_notes', label: 'Başvuru Notu', type: 'long' },
      { key: 'review_notes', label: 'İnceleme Notu', type: 'long' },
    ] },
    { title: 'Meta', icon: 'Settings', rows: [
      { key: 'approved_event_id', label: 'Onaylanan Etkinlik', type: 'university' },
      { key: 'created_at', label: 'Oluşturuldu', type: 'date' },
      { key: 'updated_at', label: 'Güncellendi', type: 'date' },
    ] },
  ],
}

const RecordShow: React.FC<ActionProps> = ({ resource, record }) => {
  const sections = SECTIONS[resource.id]
  if (!sections) {
    return (
      <Box bg="white" boxShadow="card" borderRadius={12} p="lg">
        <Text color="grey60">Bu kayıt için özel görünüm tanımlı değil.</Text>
      </Box>
    )
  }
  return (
    <Box variant="grey" style={{ minHeight: '100%' }}>
      <Box flex flexWrap="wrap" style={{ gap: 16 }}>
        {sections.map((section) => <SectionCard key={section.title} section={section} record={record} />)}
      </Box>
    </Box>
  )
}

export default RecordShow
