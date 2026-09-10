import type {
  CoachProfile,
  CoachFeedbackInput,
  CoachProfileUpdate,
  CoachRequest,
  CreateCoachRequest,
  AnyPublicCoachResult,
  PublicCoachCitationV2,
} from '@en/common/coach'
import {
  anyPublicCoachResultSchema,
  citationLocatorSchema,
  publicCoachCitationV2Schema,
  type CitationLocator,
} from '@en/common/coach'

export type {
  CoachProfile,
  CoachFeedbackInput,
  CoachProfileUpdate,
  CoachRequest,
  CreateCoachRequest,
  PublicCoachCitationV2,
}

export type CoachResult = AnyPublicCoachResult

export function parseCoachResultContract(value: unknown): CoachResult {
  return anyPublicCoachResultSchema.parse(value)
}

export function parseCoachCitationContract(
  value: unknown,
): PublicCoachCitationV2 {
  return publicCoachCitationV2Schema.parse(value)
}

export function controlledCitationRoute(value: unknown): string | null {
  const parsed = citationLocatorSchema.safeParse(value)
  if (!parsed.success) return null
  const locator: CitationLocator = parsed.data
  const id = encodeURIComponent(locator.id)
  if (locator.kind === 'word') return `/word-book/index?citation=${id}`
  if (locator.kind === 'course') return `/courses/index?citation=${id}`
  return null
}

export type CoachConversation = {
  id: string
  title: string | null
  status: 'ACTIVE' | 'DELETING' | 'DELETED' | 'EXPIRED'
  lastActivityAt: string
  expiresAt: string
  createdAt: string
}

export type CoachMessage = {
  id: string
  role: 'USER' | 'COACH'
  content: string | null
  structuredResult: CoachResult | null
  createdAt: string
}

export type CoachConversationList = {
  items: CoachConversation[]
  nextCursor: string | null
}

export type CoachConversationDetail = {
  conversation: CoachConversation
  messages: CoachMessage[]
  nextCursor: string | null
}

export type CoachRequestAccepted = {
  requestId: string
  conversationId: string
  status: 'CREATED' | 'QUEUED'
  streamUrl: string
  traceId: string
}
