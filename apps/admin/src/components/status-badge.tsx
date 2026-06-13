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
  appeal_status: {
    pending: { variant: 'info', label: 'Bekliyor' },
    under_review: { variant: 'secondary', label: 'İncelemede' },
    accepted: { variant: 'success', label: 'Kabul' },
    rejected: { variant: 'danger', label: 'Reddedildi' },
  },
  appeal_type: {
    sanction: { variant: 'secondary', label: 'Yaptırım' },
    content_removal: { variant: 'info', label: 'İçerik Kaldırma' },
    account_ban: { variant: 'danger', label: 'Hesap Banı' },
  },
  ops_state: {
    open: { variant: 'info', label: 'Açık' },
    in_progress: { variant: 'secondary', label: 'İşlemde' },
    resolved: { variant: 'success', label: 'Çözüldü' },
    dismissed: { variant: 'default', label: 'Kapatıldı' },
  },
  queue_domain: {
    moderation: { variant: 'primary', label: 'Moderasyon' },
    event_submissions: { variant: 'info', label: 'Etkinlik' },
    story_placements: { variant: 'secondary', label: 'Story' },
    support_tickets: { variant: 'default', label: 'Destek' },
    fraud_review: { variant: 'danger', label: 'Fraud' },
  },
  // P0/P1 = high → danger; P2 = medium; P3 = low. Reused by ops + word rules + incidents.
  severity: {
    P0: { variant: 'danger', label: 'P0' },
    P1: { variant: 'danger', label: 'P1' },
    P2: { variant: 'secondary', label: 'P2' },
    P3: { variant: 'default', label: 'P3' },
  },
  scan_decision: {
    allow: { variant: 'success', label: 'İzin' },
    review: { variant: 'info', label: 'İncele' },
    block: { variant: 'danger', label: 'Blok' },
  },
  scan_scope: {
    kursu_post: { variant: 'info', label: 'İtiraf' },
    kursu_comment: { variant: 'secondary', label: 'Yorum' },
  },
  word_action: {
    block: { variant: 'danger', label: 'Blok' },
    review: { variant: 'info', label: 'İncele' },
  },
  word_category: {
    profanity: { variant: 'secondary', label: 'Küfür' },
    hate_speech: { variant: 'danger', label: 'Nefret Söylemi' },
    sexual_harassment: { variant: 'danger', label: 'Cinsel Taciz' },
    targeted_abuse: { variant: 'danger', label: 'Hedefli Taciz' },
    spam_link: { variant: 'info', label: 'Spam Link' },
    phone: { variant: 'info', label: 'Telefon' },
    external_contact: { variant: 'info', label: 'Dış İletişim' },
    mass_repeat: { variant: 'default', label: 'Toplu Tekrar' },
  },
  match_type: {
    exact_token: { variant: 'info', label: 'Tam Kelime' },
    contains: { variant: 'secondary', label: 'İçerir' },
    regex: { variant: 'default', label: 'Regex' },
  },
  rule_scope: {
    shared: { variant: 'primary', label: 'Genel' },
    kursu_post: { variant: 'info', label: 'İtiraf' },
    kursu_comment: { variant: 'secondary', label: 'Yorum' },
  },
  push_status: {
    draft: { variant: 'default', label: 'Taslak' },
    dry_run: { variant: 'info', label: 'Deneme' },
    pending_approval: { variant: 'secondary', label: 'Onay Bekliyor' },
    sending: { variant: 'info', label: 'Gönderiliyor' },
    sent: { variant: 'success', label: 'Gönderildi' },
    failed: { variant: 'danger', label: 'Başarısız' },
  },
  target_platform: {
    all: { variant: 'default', label: 'Hepsi' },
    ios: { variant: 'info', label: 'iOS' },
    android: { variant: 'secondary', label: 'Android' },
  },
  incident_status: {
    open: { variant: 'danger', label: 'Açık' },
    monitoring: { variant: 'secondary', label: 'İzleniyor' },
    resolved: { variant: 'success', label: 'Çözüldü' },
  },
  // ── boolean maps (keys are normalized 'true' / 'false') ──
  bool_enabled: { true: { variant: 'success', label: 'Aktif' }, false: { variant: 'default', label: 'Pasif' } },
  bool_flagged: { true: { variant: 'danger', label: 'İşaretli' }, false: { variant: 'default', label: 'Temiz' } },
  bool_hidden: { true: { variant: 'danger', label: 'Gizli' }, false: { variant: 'success', label: 'Görünür' } },
  bool_active: { true: { variant: 'success', label: 'Aktif' }, false: { variant: 'default', label: 'Pasif' } },
  bool_verified: { true: { variant: 'info', label: 'Doğrulanmış' }, false: { variant: 'default', label: '—' } },
  bool_admin: { true: { variant: 'primary', label: 'Admin' }, false: { variant: 'default', label: '—' } },
  bool_banned: { true: { variant: 'danger', label: 'Banlı' }, false: { variant: 'success', label: 'Aktif' } },
  bool_restricted: { true: { variant: 'secondary', label: 'Kısıtlı' }, false: { variant: 'default', label: '—' } },
  bool_sponsored: { true: { variant: 'primary', label: 'Sponsorlu' }, false: { variant: 'default', label: '—' } },
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
