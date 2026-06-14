import { createZodDto } from 'nestjs-zod'
import { telemetryEventBodySchema } from '@ekler/contracts'

export class TelemetryEventBodyDto extends createZodDto(telemetryEventBodySchema) {}
