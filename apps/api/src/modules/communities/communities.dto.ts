import { createZodDto } from 'nestjs-zod'
import {
  communityFeedQuerySchema,
  createCommunityBodySchema,
  createCommunityEventBodySchema,
  createCommunityPostBodySchema,
  memberActionBodySchema,
} from '@ekler/contracts'

export class CommunityFeedQueryDto extends createZodDto(communityFeedQuerySchema) {}
export class CreateCommunityBodyDto extends createZodDto(createCommunityBodySchema) {}
export class CreateCommunityPostBodyDto extends createZodDto(createCommunityPostBodySchema) {}
export class CreateCommunityEventBodyDto extends createZodDto(createCommunityEventBodySchema) {}
export class MemberActionBodyDto extends createZodDto(memberActionBodySchema) {}
