import { createZodDto } from 'nestjs-zod'
import { communityFeedQuerySchema, createCommunityBodySchema } from '@ekler/contracts'

export class CommunityFeedQueryDto extends createZodDto(communityFeedQuerySchema) {}
export class CreateCommunityBodyDto extends createZodDto(createCommunityBodySchema) {}
