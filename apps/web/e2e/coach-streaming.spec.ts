import { expect, test, type Page, type Route } from '@playwright/test'

const now = '2026-09-02T00:00:00.000Z'
const conversation = {
  id: 'conversation-a',
  title: 'Coach',
  status: 'ACTIVE',
  lastActivityAt: now,
  expiresAt: '2026-12-01T00:00:00.000Z',
  createdAt: now,
}
const answerResult = {
  schemaVersion: 'coach.result.v1',
  responseType: 'answer',
  correction: '',
  explanation: 'Went is the past tense of go.',
  examples: ['I went home yesterday.'],
  errorTypes: [],
  score: null,
  nextAction: 'continue',
  citations: [],
  nextActionReason: 'Continue with another example.',
  traceId: 'trace_browser_001',
}

function envelope(data: unknown) {
  return { success: true, code: 0, message: 'Success', data }
}

function sseEvent(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  requestId = 'request_00001',
) {
  const event = {
    schemaVersion: 'coach.sse.v1',
    eventId: `event_${sequence}`,
    requestId,
    sequence,
    timestamp: now,
    type,
    payload,
  }
  return `id: ${event.eventId}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`
}

async function baseRoutes(
  page: Page,
  stream: (route: Route) => Promise<void>,
  durableResult = answerResult,
) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'user',
      JSON.stringify({
        user: {
          id: 'coach-e2e-user-a',
          name: 'Learner',
          phone: '10000000000',
          wordNumber: 0,
          dayNumber: 0,
          createdAt: '2026-09-02T00:00:00.000Z',
          updatedAt: '2026-09-02T00:00:00.000Z',
          token: { accessToken: 'access-a', refreshToken: 'refresh-a' },
        },
      }),
    )
  })
  await page.route('**/socket.io/**', (route) => route.abort())
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({})) }),
  )
  await page.route('**/ai/v1/coach/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        envelope({
          cefrLevel: 'A2',
          levelSource: 'USER_DECLARED',
          goalType: 'GENERAL',
          goalText: null,
          activeCourseId: null,
          timezone: 'Asia/Shanghai',
          updatedAt: now,
        }),
      ),
    }),
  )
  await page.route('**/ai/v1/coach/conversations?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(envelope({ items: [conversation], nextCursor: null })),
    }),
  )
  await page.route('**/ai/v1/coach/conversations/conversation-a?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        envelope({ conversation, messages: [], nextCursor: null }),
      ),
    }),
  )
  await page.route('**/ai/v1/coach/conversations/conversation-a/requests', (route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify(
        envelope({
          requestId: 'request_00001',
          conversationId: 'conversation-a',
          status: 'QUEUED',
          streamUrl: '/ai/v1/coach/requests/request_00001/events',
          traceId: 'trace_browser_001',
        }),
      ),
    }),
  )
  await page.route('**/ai/v1/coach/requests/request_00001/events', stream)
  await page.route('**/ai/v1/coach/requests/request_00001', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        envelope({
          id: 'request_00001',
          conversationId: 'conversation-a',
          inputType: 'MESSAGE',
          retryOfRequestId: null,
          intent: 'ANSWER',
          status: 'COMPLETED',
          finalResult: durableResult,
          error: null,
          traceId: 'trace_browser_001',
          createdAt: now,
          updatedAt: now,
          startedAt: now,
          finishedAt: now,
        }),
      ),
    }),
  )
}

async function openCoach(page: Page) {
  await page.goto('coach/index')
  await expect(page.getByRole('heading', { name: '个性化英语学习 Coach' })).toBeVisible()
}

async function send(page: Page) {
  await page.getByPlaceholder('可以问单词、语法、句子纠错或学习方法…').fill('Explain went.')
  await page.getByRole('button', { name: '发送' }).click()
}

test('shows safe tool progress and one authoritative final result', async ({ page }) => {
  await baseRoutes(page, async (route) => {
    const body =
      sseEvent(0, 'connected', { status: 'QUEUED', replayedThrough: null }) +
      sseEvent(1, 'tool_status', {
        tool: 'get_learner_profile',
        state: 'started',
        label: '学习画像正在处理',
        retryable: null,
      }) +
      sseEvent(2, 'result', { result: answerResult }) +
      sseEvent(3, 'completed', {
        status: 'COMPLETED',
        resultEventId: 'event_2',
        learningSaveStatus: 'not_applicable',
      })
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  })
  await openCoach(page)
  await send(page)
  await expect(page.getByText('Went is the past tense of go.')).toBeVisible()
  await expect(page.locator('[data-test="coach-progress"]')).toContainText('Coach 已完成')
  const visible = await page.locator('body').innerText()
  expect(visible).not.toMatch(/systemPrompt|reasoning|answerKey|gradingRubric/i)
})

test('uses 410 durable reconciliation without creating another request', async ({ page }) => {
  let posts = 0
  await baseRoutes(page, async (route) => route.fulfill({ status: 410, body: '{}' }))
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/requests')) posts += 1
  })
  await openCoach(page)
  await send(page)
  await expect(page.getByText('Went is the past tense of go.')).toBeVisible()
  expect(posts).toBe(1)
})

test('shows timeout and budget terminal failures', async ({ page }) => {
  await baseRoutes(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseEvent(0, 'error', {
        code: 'BUDGET_EXCEEDED',
        message: '本次请求已达到预算上限。',
        retryable: false,
        retryAfterSeconds: null,
        saveStatus: 'NOT_STARTED',
      }),
    })
  })
  await openCoach(page)
  await send(page)
  await expect(page.getByText('本次请求已达到预算上限。').first()).toBeVisible()
})

test('shows an explicit timeout terminal state', async ({ page }) => {
  await baseRoutes(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseEvent(0, 'error', {
        code: 'REQUEST_TIMEOUT',
        message: '本次请求已超时。',
        retryable: true,
        retryAfterSeconds: null,
        saveStatus: 'NOT_STARTED',
      }),
    })
  })
  await openCoach(page)
  await send(page)
  await expect(page.getByText('本次请求已超时。').first()).toBeVisible()
})

test('recovers from network failure only through explicit retry', async ({ page }) => {
  await baseRoutes(page, async (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/ai/v1/coach/requests/request_00001/retry', (route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify(
        envelope({
          requestId: 'request_00002',
          conversationId: 'conversation-a',
          status: 'QUEUED',
          streamUrl: '/ai/v1/coach/requests/request_00002/events',
          traceId: 'trace_browser_002',
        }),
      ),
    }),
  )
  await page.route('**/ai/v1/coach/requests/request_00002/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        sseEvent(0, 'result', { result: answerResult }, 'request_00002') +
        sseEvent(
          1,
          'completed',
          {
            status: 'COMPLETED',
            resultEventId: 'event_0',
            learningSaveStatus: 'not_applicable',
          },
          'request_00002',
        ),
    }),
  )
  await openCoach(page)
  await send(page)
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.getByText('Went is the past tense of go.')).toBeVisible()
})

test('shows the authoritative saved learning state after grading', async ({ page }) => {
  const grading = {
    schemaVersion: 'coach.result.v1',
    responseType: 'grading',
    correction: 'went',
    explanation: 'Use past tense.',
    examples: [],
    errorTypes: ['TENSE'],
    score: 80,
    nextAction: 'review',
    citations: [],
    nextActionReason: 'Review tomorrow.',
    traceId: 'trace_grading_browser',
    gradingItems: [
      {
        itemId: 'exercise_item_00001',
        isCorrect: false,
        score: 80,
        correction: 'went',
        explanation: 'Use past tense.',
        errorTypes: ['TENSE'],
      },
    ],
    learningUpdate: {
      status: 'saved',
      attemptId: 'attempt_00001',
      changes: [],
      savedAt: now,
    },
  }
  await baseRoutes(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        sseEvent(0, 'result', { result: grading }) +
        sseEvent(1, 'completed', {
          status: 'COMPLETED',
          resultEventId: 'event_0',
          learningSaveStatus: 'saved',
        }),
    })
  }, grading)
  await openCoach(page)
  await send(page)
  await expect(page.getByText('学习状态已更新')).toBeVisible()
  await expect(page.getByText('80').first()).toBeVisible()
})

test('cancels an in-flight stream through the explicit API', async ({ page }) => {
  let cancelHeader = ''
  await baseRoutes(page, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await route.abort()
  })
  await page.route('**/ai/v1/coach/requests/request_00001/cancel', async (route) => {
    cancelHeader = route.request().headers()['idempotency-key'] ?? ''
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify(envelope({ status: 'CANCELLED', saveStatus: 'NOT_SAVED' })),
    })
  })
  await openCoach(page)
  await send(page)
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByText('请求已取消，本次未保存新的学习记录').first()).toBeVisible()
  expect(cancelHeader).toMatch(/^cancel-/)
})
