import { aiApi, type Response } from '@/apis'
import type {
  CoachConversation,
  CoachConversationDetail,
  CoachConversationList,
  CoachFeedbackInput,
  CoachProfile,
  CoachProfileUpdate,
  CoachRequest,
  CoachRequestAccepted,
  CreateCoachRequest,
  PublicCoachCitationV2,
} from './contracts'
import { citationIdSchema } from '@en/common/coach'
import { parseCoachCitationContract } from './contracts'

const idempotencyHeaders = (key: string) => ({
  headers: { 'Idempotency-Key': key },
})

export const getCoachProfile = () =>
  aiApi.get('/coach/profile') as Promise<Response<CoachProfile>>

export const updateCoachProfile = (
  update: CoachProfileUpdate,
  idempotencyKey: string,
) =>
  aiApi.patch(
    '/coach/profile',
    update,
    idempotencyHeaders(idempotencyKey),
  ) as Promise<Response<CoachProfile>>

export const createCoachConversation = (
  input: { title?: string },
  idempotencyKey: string,
) =>
  aiApi.post(
    '/coach/conversations',
    input,
    idempotencyHeaders(idempotencyKey),
  ) as Promise<Response<CoachConversation>>

export const listCoachConversations = (params?: {
  cursor?: string
  limit?: number
}) =>
  aiApi.get('/coach/conversations', { params }) as Promise<
    Response<CoachConversationList>
  >

export const getCoachConversation = (
  conversationId: string,
  params?: { cursor?: string; limit?: number },
) =>
  aiApi.get(`/coach/conversations/${conversationId}`, { params }) as Promise<
    Response<CoachConversationDetail>
  >

export const createCoachRequest = (
  conversationId: string,
  input: CreateCoachRequest,
  idempotencyKey: string,
) =>
  aiApi.post(
    `/coach/conversations/${conversationId}/requests`,
    input,
    idempotencyHeaders(idempotencyKey),
  ) as Promise<Response<CoachRequestAccepted>>

export const getCoachRequest = (requestId: string) =>
  aiApi.get(`/coach/requests/${requestId}`) as Promise<
    Response<CoachRequest>
  >

export async function getCoachCitation(
  citationId: string,
): Promise<Response<PublicCoachCitationV2>> {
  const parsedId = citationIdSchema.safeParse(citationId)
  if (!parsedId.success) throw new Error('INVALID_CITATION_ID')
  const response = (await aiApi.get(
    `/coach/citations/${encodeURIComponent(parsedId.data)}`,
  )) as Response<unknown>
  return {
    ...response,
    data: parseCoachCitationContract(response.data),
  }
}

export const cancelCoachRequest = (
  requestId: string,
  idempotencyKey: string,
) =>
  aiApi.post(
    `/coach/requests/${requestId}/cancel`,
    {},
    idempotencyHeaders(idempotencyKey),
  ) as Promise<
    Response<{
      status: 'CANCELLED' | 'COMPLETED'
      saveStatus: 'NOT_STARTED' | 'NOT_SAVED' | 'SAVED_ONCE' | 'NOT_APPLICABLE'
    }>
  >

export const retryCoachRequest = (
  requestId: string,
  idempotencyKey: string,
) =>
  aiApi.post(
    `/coach/requests/${requestId}/retry`,
    {},
    idempotencyHeaders(idempotencyKey),
  ) as Promise<Response<CoachRequestAccepted | CoachRequest>>

export const upsertCoachFeedback = (
  requestId: string,
  input: CoachFeedbackInput,
  idempotencyKey: string,
) =>
  aiApi.put(
    `/coach/requests/${requestId}/feedback`,
    input,
    idempotencyHeaders(idempotencyKey),
  ) as Promise<
    Response<{
      requestId: string
      rating: 'UP' | 'DOWN'
      category: CoachFeedbackInput['category'] | null
      comment: string | null
      updatedAt: string
    }>
  >

export const deleteCoachConversation = (
  conversationId: string,
  idempotencyKey: string,
) =>
  aiApi.delete(`/coach/conversations/${conversationId}`, {
    ...idempotencyHeaders(idempotencyKey),
  }) as Promise<
    Response<{
      deletionId: string
      status: 'ACCEPTED' | 'PURGING' | 'COMPLETED'
      hiddenAt: string
      purgeDeadline: string
    }>
  >

export const deleteCoachData = (idempotencyKey: string) =>
  aiApi.delete('/coach/data', {
    ...idempotencyHeaders(idempotencyKey),
    data: { confirmation: 'DELETE_COACH_DATA' },
  }) as Promise<
    Response<{
      deletionId: string
      status: 'ACCEPTED' | 'PURGING' | 'COMPLETED'
      hiddenAt: string
      purgeDeadline: string
    }>
  >

export type * from './contracts'
export {
  controlledCitationRoute,
  parseCoachCitationContract,
  parseCoachResultContract,
} from './contracts'
