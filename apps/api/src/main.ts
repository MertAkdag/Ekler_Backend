import 'reflect-metadata'
import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { Logger } from '@nestjs/common'
import { AppModule } from './app.module'

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

  const port = Number(process.env.PORT ?? 3000)
  await app.listen({ port, host: '0.0.0.0' })
  new Logger('bootstrap').log(`ekler-api listening on :${port} (prefix /v1)`)
}

void bootstrap()
