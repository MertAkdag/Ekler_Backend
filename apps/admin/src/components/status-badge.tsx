import React from 'react'
import type { BasePropertyProps } from 'adminjs'
import { Badge, Text } from '@adminjs/design-system'

// 'light' is omitted on purpose: the theme has no colors.light, so a 'light'
// badge would render an invisible pill. Keep the union to colors that exist.
type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'info' | 'default'
type Entry = { variant: Variant; label: string }
type BadgeMap = Record<string, Entry>

/**
 * One value-driven badge component for every status/boolean column. The per-column
 * map is selected by `property.custom.badgeMap` (set in resources.ts). Boolean maps
 * are keyed by the normalized 'true' / 'false' strings produced by toKey().
 */
const MAPS: Record<string, BadgeMap> = {
  moderation_status: {
    published: { variant: 'success', label: 'Yayında' },
    needs_review: { variant: 'info', label: 'İncelenecek' },
    hidden: { variant: 'danger', label: 'Gizli' },
  },
  report_status: {
    pending: { variant: 'info', label: 'Bekliyor' },
    reviewed: { variant: 'success', label: 'İncelendi' },
    dismissed: { variant: 'default', label: 'Reddedildi' },
  },
  session_status: {
    active: { variant: 'success', label: 'Aktif' },
    full: { variant: 'info', label: 'Dolu' },
    ended: { variant: 'default', label: 'Bitti' },
    cancelled: { variant: 'danger', label: 'İptal' },
  },
  submission_status: {
    pending: { variant: 'info', label: 'Bekliyor' },
    approved: { variant: 'success', label: 'Onaylandı' },
    rejected: { variant: 'danger', label: 'Reddedildi' },
  },
  confession_category: {
    confession: { variant: 'primary', label: 'İtiraf' },
    question: { variant: 'info', label: 'Soru' },
    complaint: { variant: 'secondary', label: 'Şikayet' },
    funny: { variant: 'success', label: 'Komik' },
  },
  sanction_type: {
    warning: { variant: 'info', label: 'Uyarı' },
    temp_ban: { variant: 'secondary', label: 'Geçici Ban' },
    permanent_ban: { variant: 'danger', label: 'Kalıcı Ban' },
  },
  report_target: {
    confession: { variant: 'default', label: 'İtiraf' },
    comment: { variant: 'default', label: 'Yorum' },
    user: { variant: 'default', label: 'Kullanıcı' },
    note: { variant: 'default', label: 'Not' },
  },
  // ── boolean maps (keys are normalized 'true' / 'false') ──
  bool_flagged: { true: { variant: 'danger', label: 'İşaretli' }, false: { variant: 'default', label: 'Temiz' } },
  bool_hidden: { true: { variant: 'danger', label: 'Gizli' }, false: { variant: 'success', label: 'Görünür' } },
  bool_active: { true: { variant: 'success', label: 'Aktif' }, false: { variant: 'default', label: 'Pasif' } },
  bool_verified: { true: { variant: 'info', label: 'Doğrulanmış' }, false: { variant: 'default', label: '—' } },
  bool_admin: { true: { variant: 'primary', label: 'Admin' }, false: { variant: 'default', label: '—' } },
  bool_banned: { true: { variant: 'danger', label: 'Banlı' }, false: { variant: 'success', label: 'Aktif' } },
  bool_restricted: { true: { variant: 'secondary', label: 'Kısıtlı' }, false: { variant: 'default', label: '—' } },
}

/** Normalize boolean | 'true'/'false' | pg 't'/'f' | enum string → lookup key. */
function toKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const s = String(value).trim()
  if (s === 't' || s === 'true' || s === '1') return 'true'
  if (s === 'f' || s === 'false' || s === '0') return 'false'
  return s
}

const StatusBadge: React.FC<BasePropertyProps> = ({ record, property }) => {
  const raw = record?.params?.[property.path]
  const key = toKey(raw)
  if (key === null) {
    return (
      <Text as="span" color="grey60">
        —
      </Text>
    )
  }

  const mapName = (property.custom?.badgeMap as string | undefined) ?? ''
  const entry = MAPS[mapName]?.[key]

  // Unknown value or unmapped column → safe neutral pill with the raw value.
  if (!entry) return <Badge variant="default">{key}</Badge>
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}

export default StatusBadge
