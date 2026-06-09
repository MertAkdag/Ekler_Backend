import { createZodDto } from 'nestjs-zod'
import { communityFeedQuerySchema } from '@ekler/contracts'

export class CommunityFeedQueryDto extends createZodDto(communityFeedQuerySchema) {}
