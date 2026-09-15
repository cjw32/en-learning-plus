import { test, expect } from "@playwright/test";
const envelope = (data: unknown) => ({ success: true, code: 200, data });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "user",
      JSON.stringify({
        user: {
          id: "citation-learner",
          name: "学习者",
          wordNumber: 0,
          dayNumber: 0,
          token: {
            accessToken: "fixture-token",
            refreshToken: "fixture-refresh",
          },
        },
      }),
    ),
  );
  await page.route("**/socket.io/**", (r) => r.abort());
  await page.route("**/ai/v1/**", (r) =>
    r.fulfill({ json: envelope({ available: false }) }),
  );
  await page.route("**/api/v1/**", (r) => r.fulfill({ json: envelope({}) }));
  await page.route("**/api/v1/learn/stats", (r) =>
    r.fulfill({
      json: envelope({
        wordNumber: 10,
        dayNumber: 3,
        checkedInToday: false,
        studyDate: "2026-09-15",
        timezone: "Asia/Shanghai",
      }),
    }),
  );
});
test("a cited word outside the first page is loaded exactly and safely", async ({
  page,
}) => {
  await page.route("**/api/v1/word-book?**", (r) =>
    r.fulfill({
      json: envelope({
        total: 500,
        list: [{ id: "first", word: "firstpage" }],
      }),
    }),
  );
  await page.route("**/api/v1/word-book/word-400", (r) =>
    r.fulfill({
      json: envelope({
        word: {
          wordId: "word-400",
          word: "citedword",
          definition: '<img src=x onerror="alert(1)">',
          translation: "准确引用",
        },
        forms: ["citedwords"],
        examples: ["An exact example."],
      }),
    }),
  );
  await page.goto("word-book/index?citation=word-400");
  const panel = page.getByRole("region", { name: "引用的单词" });
  await expect(panel.getByRole("heading", { name: "citedword" })).toBeVisible();
  await expect(panel).toBeFocused();
  await expect(panel.getByText("准确引用")).toBeVisible();
  await expect(panel.locator("img")).toHaveCount(0);
  await expect(page.getByText("累计 3 天")).toBeVisible();
});
test("a removed word gives a retryable state instead of an empty jump", async ({
  page,
}) => {
  await page.route("**/api/v1/word-book?**", (r) =>
    r.fulfill({ json: envelope({ total: 0, list: [] }) }),
  );
  await page.route("**/api/v1/word-book/missing", (r) =>
    r.fulfill({ status: 404, json: { success: false, data: null } }),
  );
  await page.goto("word-book/index?citation=missing");
  await expect(
    page.getByText("引用的单词已删除、无权显示或暂时无法读取。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "重新定位" })).toBeVisible();
});
test("course citation scrolls, focuses and highlights the matching card", async ({
  page,
}) => {
  await page.route("**/api/v1/course/list", (r) =>
    r.fulfill({
      json: envelope(
        Array.from({ length: 12 }, (_, i) => ({
          id: `course-${i}`,
          name: `课程 ${i}`,
          description: "学习内容",
          teacher: "老师",
          price: 0,
          url: "",
        })),
      ),
    }),
  );
  await page.goto("courses/index?citation=course-10");
  const card = page.locator('[data-course-id="course-10"]');
  await expect(card).toBeFocused();
  await expect(card).toHaveClass(/ring-blue-500/);
  await expect(card).toBeInViewport();
  await page.goto("courses/index?citation=missing");
  await expect(
    page.getByText("引用课程不存在，或当前列表中不可访问。"),
  ).toBeVisible();
});
test("successful learning refreshes the daily badge without re-login", async ({
  page,
}) => {
  let saved = false;
  await page.route("**/api/v1/learn/stats", (r) =>
    r.fulfill({
      json: envelope({
        wordNumber: saved ? 11 : 10,
        dayNumber: saved ? 4 : 3,
        checkedInToday: saved,
        studyDate: "2026-09-15",
        timezone: "Asia/Shanghai",
      }),
    }),
  );
  await page.route("**/api/v1/learn/word/course-a", (r) =>
    r.fulfill({
      json: envelope([
        {
          id: "word-a",
          word: "a",
          definition: "one letter",
          translation: "一个字母",
        },
      ]),
    }),
  );
  await page.route("**/api/v1/learn/word/master", (r) => {
    saved = true;
    return r.fulfill({ json: envelope({ wordNumber: 11, dayNumber: 4 }) });
  });
  await page.goto("courses/learn/course-a/Practice");
  await expect(page.getByText("累计 3 天")).toBeVisible();
  await page.locator('input[maxlength="1"]').fill("a");
  await page.getByRole("button", { name: "下一个", exact: true }).click();
  await expect(page.getByText("累计 4 天")).toBeVisible();
  await expect(page.getByText("✓", { exact: true })).toBeVisible();
});
test("failed course citation loading can be retried without changing pages", async ({
  page,
}) => {
  let failed = true;
  await page.route("**/api/v1/course/list", (r) =>
    failed
      ? r.fulfill({ status: 503, json: { success: false } })
      : r.fulfill({
          json: envelope([
            {
              id: "course-retry",
              name: "重新加载课程",
              description: "内容",
              teacher: "老师",
              price: 0,
              url: "",
            },
          ]),
        }),
  );
  await page.goto("courses/index?citation=course-retry");
  await expect(page.getByText("课程读取失败，请重试。")).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.locator('[data-course-id="course-retry"]')).toBeFocused();
});
