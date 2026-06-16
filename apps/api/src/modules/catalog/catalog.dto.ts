import { createZodDto } from 'nestjs-zod'
import { byDomainQuerySchema, catalogScopeQuerySchema } from '@ekler/contracts'

export class ByDomainQueryDto extends createZodDto(byDomainQuerySchema) {}
export class CatalogScopeQueryDto extends createZodDto(catalogScopeQuerySchema) {}
