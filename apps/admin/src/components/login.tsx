import React from 'react'
import { Box, Button, FormGroup, Input, Label, MessageBox, Text } from '@adminjs/design-system'

/**
 * Kurumsal giriş ekranı — AdminJS'in varsayılan Login'ini override eder.
 *
 * Varsayılan ekrandaki astronot/gezegen illüstrasyonlarını ve "made with love"
 * rozetini kaldırır; yerine bordo marka paneli + sade form koyar. Form, AdminJS'in
 * beklediği gibi `action`'a `email` + `password` alanlarıyla POST eder.
 */
interface LoginProps {
  action: string
  message?: string
}

const Login: React.FC<LoginProps> = ({ action, message }) => {
  return (
    <Box
      flex
      justifyContent="center"
      alignItems="center"
      style={{ minHeight: '100vh', background: '#F2F5F6', padding: 24 }}
    >
      <Box
        flex
        style={{
          width: '100%',
          maxWidth: 880,
          minHeight: 480,
          background: '#fff',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(10, 13, 14, 0.12)',
        }}
      >
        {/* Marka paneli */}
        <Box
          className="ekler-login__brand"
          style={{
            width: 360,
            flexShrink: 0,
            background: 'linear-gradient(160deg, #9E2035 0%, #420011 100%)',
            color: '#fff',
            padding: 44,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <Box flex alignItems="center" style={{ gap: 12 }}>
            <img src="/public/ekler-mark-light.png" alt="" style={{ height: 42, width: 'auto' }} />
            <span className="ekler-login__word" style={{ fontSize: 36, lineHeight: 1, color: '#fff' }}>
              ekler
            </span>
          </Box>

          <Box>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: 300, marginBottom: 10 }}>
              Yönetim Paneli
            </Text>
            <Text style={{ color: 'rgba(255, 255, 255, 0.72)', fontSize: 14, lineHeight: 1.6 }}>
              İçerik, moderasyon ve topluluk yönetimi tek panelde.
            </Text>
          </Box>

          <Text style={{ color: 'rgba(255, 255, 255, 0.45)', fontSize: 12, letterSpacing: 0.4 }}>
            ekler · yönetim
          </Text>
        </Box>

        {/* Form paneli */}
        <Box as="form" action={action} method="POST" flexGrow={1} style={{ padding: 44 }}>
          <Text style={{ fontSize: 24, color: '#0A0D0E', fontWeight: 500, marginBottom: 6 }}>
            Giriş yap
          </Text>
          <Text style={{ color: '#58696D', fontSize: 14, marginBottom: 28 }}>
            Devam etmek için yönetici hesabınla giriş yap.
          </Text>

          {message && (
            <Box style={{ marginBottom: 18 }}>
              <MessageBox variant="danger" message="E-posta veya şifre hatalı." />
            </Box>
          )}

          <FormGroup>
            <Label required>E-posta</Label>
            <Input
              name="email"
              type="email"
              placeholder="ornek@ekler.app"
              autoComplete="username"
              width="100%"
            />
          </FormGroup>
          <FormGroup>
            <Label required>Şifre</Label>
            <Input
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              width="100%"
            />
          </FormGroup>

          <Box style={{ marginTop: 28 }}>
            <Button variant="primary" type="submit" style={{ width: '100%' }}>
              Giriş yap
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default Login
