import { expect, test, type Page } from "@playwright/test";

const now = "2026-09-03T00:00:00.000Z";

function envelope(data: unknown) {
  return {
    timestamp: now,
    path: "/test",
    message: "Success",
    code: 200,
    success: true,
    data,
  };
}

async function installAuthenticatedLearner(page: Page) {
  await page.addInitScript((now) => {
    localStorage.setItem(
      "user",
      JSON.stringify({
        user: {
          id: "legacy-browser-user",
          name: "Legacy Learner",
          email: "legacy-browser@example.test",
          phone: "legacy-browser-phone",
          address: "",
          avatar: "",
          bio: "",
          isTimingTask: false,
          timingTaskTime: "00:00:00",
          wordNumber: 0,
          dayNumber: 0,
          createdAt: now,
          updatedAt: now,
          token: {
            accessToken: "legacy-access-token",
            refreshToken: "legacy-refresh-token",
          },
        },
      }),
    );
  }, now);
}

async function installCommonRoutes(page: Page) {
  await page.route("**/socket.io/**", (route) => route.abort());
  await page.route("**/api/v1/learn/stats", (route) =>
    route.fulfill({ json: envelope({ wordNumber: 0, dayNumber: 0, checkedInToday: false, studyDate: '2026-09-15', timezone: 'Asia/Shanghai' }) }),
  );
  await page.route("**/api/v1/tracker/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({})),
    }),
  );
  await page.route("**/api/v1/word-book**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          total: 1,
          list: [
            {
              id: "legacy-word-1",
              word: "legacyword",
              phonetic: "/test/",
              definition: "a regression fixture",
              translation: "回归夹具",
              cet4: true,
            },
          ],
        }),
      ),
    }),
  );
  await page.route("**/api/v1/course/list", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope([
          {
            id: "legacy-course-1",
            name: "Legacy CET4",
            value: "cet4",
            description: "Existing course remains visible",
            teacher: "Test Teacher",
            url: "/test.png",
            price: "9.90",
          },
        ]),
      ),
    }),
  );
  await page.route("**/ai/v1/prompt/list", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope([
          { id: "1", label: "💬 智能助手", role: "normal" },
          { id: "2", label: "🎓 英语大师", role: "master" },
          { id: "3", label: "💼 商务英语", role: "business" },
          { id: "4", label: "🐉 麒麟哥", role: "qilinge" },
          { id: "5", label: "💻 小满模式", role: "xiaoman" },
        ]),
      ),
    }),
  );
  await page.route("**/ai/v1/chat/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope([])),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await installAuthenticatedLearner(page);
  await installCommonRoutes(page);
});

test("home, dictionary and course pages remain usable without Coach traffic", async ({
  page,
}) => {
  const coachRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/ai/v1/coach"))
      coachRequests.push(request.url());
  });

  await page.goto("");
  await expect(page.getByText("重新定义英语学习方式")).toBeVisible();

  await page.goto("word-book/index");
  await expect(page.getByText("词库列表")).toBeVisible();
  await expect(page.getByText("legacyword")).toBeVisible();

  await page.goto("courses/index");
  await expect(page.getByRole("heading", { name: "精选课程" })).toBeVisible();
  await expect(page.getByText("Legacy CET4")).toBeVisible();
  expect(coachRequests).toEqual([]);
});

test("settings and all five generic AI modes retain their existing routes", async ({
  page,
}) => {
  await page.goto("setting/index");
  await expect(page.getByText("在这里修改你的个人信息与头像")).toBeVisible();
  await expect(page.getByText("已登录")).toBeVisible();

  await page.goto("chat/index");
  await expect(page.getByText("💬 智能助手")).toBeVisible();
  await expect(page.getByText("🎓 英语大师")).toBeVisible();
  await expect(page.getByText("💼 商务英语")).toBeVisible();
  await expect(page.getByText("🐉 麒麟哥")).toBeVisible();
  await expect(page.getByText("💻 小满模式")).toBeVisible();
  await expect(page.getByPlaceholder("请输入内容")).toBeVisible();
  await expect(page.getByText("深度思考")).toBeVisible();
  await expect(page.getByText("联网搜索")).toBeVisible();
});

test('legacy chat authenticates streaming and renders malicious model HTML as text', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  let authorization: string | undefined;
  await page.route('**/ai/v1/chat', async route => {
    submitted = route.request().postDataJSON();
    authorization = route.request().headers().authorization;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      `data: ${JSON.stringify({ role: 'ai', type: 'chat', content: '<img src=x onerror="window.chatInjected=true"> **safe answer** [bad](javascript:alert%281%29)' })}\n\n` });
  });
  await page.goto('chat/index');
  const input = page.getByPlaceholder('请输入内容');
  await expect(page.getByText('💬 智能助手')).toBeVisible();
  await input.fill('Explain a word');
  await input.press('Enter');
  await expect(page.getByText('safe answer', { exact: true })).toBeVisible();
  expect(authorization).toBe('Bearer legacy-access-token');
  expect(submitted).toMatchObject({ role: 'normal' });
  expect(String(submitted?.['content']).trim()).toBe('Explain a word');
  expect(submitted).not.toHaveProperty('userId');
  await expect(page.locator('.deepseek-markdown img')).toHaveCount(0);
  await expect(page.locator('.deepseek-markdown a')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { chatInjected?: boolean }).chatInjected)).toBeUndefined();
});

test('finishing the last course word saves before requesting another batch', async ({ page }) => {
  const saved: unknown[] = [];
  await page.route('**/api/v1/learn/word/legacy-course-1', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(envelope([
      { id: 'word-a', word: 'a', definition: 'one letter', translation: '一个字母' },
    ])),
  }));
  await page.route('**/api/v1/learn/word/master', route => {
    saved.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({ wordNumber: 1 })) });
  });
  await page.goto('courses/learn/legacy-course-1/Legacy');
  await page.locator('input[maxlength="1"]').fill('a');
  await page.getByRole('button', { name: '下一个', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('学习进度已保存');
  expect(saved).toEqual([{ wordIds: ['word-a'] }]);
  await expect(page.getByRole('button', { name: '再练一组' })).toBeVisible();
});
