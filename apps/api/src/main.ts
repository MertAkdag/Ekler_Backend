import 'reflect-metadata'
import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { Logger } from '@nestjs/common'
import { AppModule } from './app.module'
import { TokenService } from './modules/auth/token.service'

// CORS methods must be enumerated explicitly on Fastify under NestJS 11.
const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  )

  app.setGlobalPrefix('v1')
  app.enableCors({ methods: CORS_METHODS })
  app.enableShutdownHooks() // closes the pg pool via DrizzleModule.onApplicationShutdown

  // Multipart (notes upload) — registered now, used from Phase 4.
  const multipart = await import('@fastify/multipart')
  await app.register(multipart.default, { limits: { fileSize: 20 * 1024 * 1024 } })

  // JWKS for our own EdDSA access tokens. Raw Fastify route (NOT under /v1 and
  // NOT enveloped) so it serves the standard `{ keys: [...] }` body external
  // verifiers expect. Public; only ever exposes public keys. Empty until
  // AUTH_JWT_* are configured.
  const tokens = app.get(TokenService)
  app.getHttpAdapter().getInstance().get('/.well-known/jwks.json', async (_req, reply) => {
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, max-age=300')
      .send(tokens.getJwks())
  })

  const port = Number(process.env.PORT ?? 3000)
  await app.listen({ port, host: '0.0.0.0' })
  new Logger('bootstrap').log(`ekler-api listening on :${port} (prefix /v1)`)
}

void bootstrap()
