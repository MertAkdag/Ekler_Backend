import React, { useState } from 'react'
import { ApiClient, useNotice, type ActionProps } from 'adminjs'
import { Box, Button, FormGroup, Label, MessageBox, Select, TextArea } from '@adminjs/design-system'

/**
 * Parameterized sanction form — custom record-action BODY for `profiles`.
 *
 * A moderator picks a sanction type (warning / temp_ban / permanent_ban), a
 * duration preset (only meaningful for a temp ban) and a free-text reason, then
 * POSTs them to the `sanction` record-action handler via api.recordAction. The
 * handler (actions.ts → userActions().sanction) runs replaceActiveSanction in a
 * transaction and inserts a moderation notification for the user.
 *
 * The admin tsconfig has no DOM lib, so `location` is reached through globalThis
 * (same pattern as hub.tsx / dashboard.tsx).
 */

type Option = { value: string; label: string }

const SANCTION_OPTIONS: Option[] = [
  { value: 'warning', label: 'Uyarı (yasak yok)' },
  { value: 'temp_ban', label: 'Geçici Yasak' },
  { value: 'permanent_ban', label: 'Kalıcı Yasak' },
]

// Duration presets in days; applied only when sanction_type === 'temp_ban'.
const DURATION_OPTIONS: Option[] = [
  { value: '1', label: '1 gün' },
  { value: '3', label: '3 gün' },
  { value: '7', label: '7 gün' },
  { value: '14', label: '14 gün' },
  { value: '30', label: '30 gün' },
  { value: '90', label: '90 gün' },
]

const api = new ApiClient()

const loc = (globalThis as { location?: { assign?: (url: string) => void; href?: string } }).location

const SanctionForm: React.FC<ActionProps> = ({ resource, record, action }) => {
  const sendNotice = useNotice()
  const [sanctionType, setSanctionType] = useState<Option>(SANCTION_OPTIONS[1] as Option)
  const [duration, setDuration] = useState<Option>(DURATION_OPTIONS[2] as Option)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isTemp = sanctionType.value === 'temp_ban'

  const onSubmit = (): void => {
    if (!record || submitting) return
    setSubmitting(true)
    api
      .recordAction({
        resourceId: resource.id,
        recordId: record.id,
        actionName: action.name,
        method: 'post',
        data: {
          sanction_type: sanctionType.value,
          duration_days: isTemp ? duration.value : '',
          reason: reason.trim(),
        },
      })
      .then((res) => {
        const data = res.data as { notice?: { message: string; type?: 'success' | 'error' | 'info' } }
        if (data.notice) sendNotice(data.notice)
        const url = `/admin/resources/${resource.id}/records/${record.id}/show`
        if (loc?.assign) loc.assign(url)
        else if (loc) loc.href = url
      })
      .catch(() => {
        sendNotice({ message: 'Yaptırım uygulanamadı.', type: 'error' })
        setSubmitting(false)
      })
  }

  return (
    <Box variant="white" boxShadow="card" p="xxl" style={{ maxWidth: 560 }}>
      <FormGroup>
        <Label required>Yaptırım Türü</Label>
        <Select
          value={sanctionType}
          options={SANCTION_OPTIONS}
          onChange={(s: Option) => setSanctionType(s)}
          isDisabled={submitting}
        />
      </FormGroup>

      {isTemp && (
        <FormGroup>
          <Label required>Süre</Label>
          <Select
            value={duration}
            options={DURATION_OPTIONS}
            onChange={(s: Option) => setDuration(s)}
            isDisabled={submitting}
          />
        </FormGroup>
      )}

      <FormGroup>
        <Label>Sebep (kullanıcıya iletilir)</Label>
        <TextArea
          width="100%"
          rows={4}
          value={reason}
          placeholder="İsteğe bağlı: bu yaptırımın gerekçesi"
          onChange={(e: { target: { value: string } }) => setReason(e.target.value)}
          disabled={submitting}
        />
      </FormGroup>

      <MessageBox
        variant="info"
        message="Uygulandığında kullanıcının mevcut aktif yaptırımı pasifleştirilir, yenisi eklenir ve kullanıcıya bildirim gönderilir."
      />

      <Box flex justifyContent="flex-end" style={{ gap: 8, marginTop: 16 }}>
        <Button variant="primary" onClick={onSubmit} disabled={submitting}>
          {submitting ? 'Uygulanıyor…' : 'Yaptırımı Uygula'}
        </Button>
      </Box>
    </Box>
  )
}

export default SanctionForm
