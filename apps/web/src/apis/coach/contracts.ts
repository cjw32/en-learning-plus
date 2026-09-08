import type {
  CoachProfile,
  CoachFeedbackInput,
  CoachProfileUpdate,
  CoachRequest,
  CoachResult,
  CreateCoachRequest,
} from '@en/common/coach'

export type {
  CoachProfile,
  CoachFeedbackInput,
  CoachProfileUpdate,
  CoachRequest,
  CoachResult,
  CreateCoachRequest,
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
