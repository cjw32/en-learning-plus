import { test, expect } from "@playwright/test";
const now = "2026-09-15T00:00:00Z";
const conversation = (id: string, title: string) => ({
  id,
  title,
  status: "ACTIVE",
  lastActivityAt: now,
  createdAt: now,
  expiresAt: "2027-01-01T00:00:00Z",
});
const result = {
  schemaVersion: "coach.result.v1",
  responseType: "answer",
  correction: "",
  explanation: "Went is the past tense of go.",
  examples: ["I went home."],
  errorTypes: [],
  score: null,
  nextAction: "continue",
  citations: [],
  nextActionReason: "Try another example.",
  traceId: "trace_management_001",
};
test("Coach history, saved feedback, new conversation, deletion and data management are usable", async ({
  page,
}) => {
  let rows = [
    conversation("conversation-a", "过去时练习"),
    conversation("conversation-b", "旅行口语"),
  ];
  let feedback: any = null;
  let feedbackCount = 0;
  let deleteCount = 0;
  let allDeleted = false;
  await page.addInitScript(() =>
    localStorage.setItem(
      "user",
      JSON.stringify({
        user: {
          id: "management-fixture-user",
          name: "练习者",
          phone: "10000000000",
          token: {
            accessToken: "fixture-token",
            refreshToken: "fixture-refresh",
          },
        },
      }),
    ),
  );
  await page.route("**/socket.io/**", (r) => r.abort());
  await page.route("**/api/v1/**", (r) =>
    r.fulfill({ json: { code: 200, data: {} } }),
  );
  await page.route("**/ai/v1/coach/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/ai/v1/coach", "");
    const method = route.request().method();
    const ok = (data: any) => route.fulfill({ json: { code: 200, data } });
    if (path === "/profile")
      return ok({
        cefrLevel: "A2",
        goalType: "GENERAL",
        goalText: null,
        levelSource: "USER_DECLARED",
        timezone: "Asia/Shanghai",
        updatedAt: now,
      });
    if (path === "/conversations" && method === "GET")
      return ok({
        items: url.searchParams.has("cursor")
          ? rows.slice(1)
          : rows.slice(0, 1),
        nextCursor:
          !url.searchParams.has("cursor") && rows.length > 1
            ? rows[0]!.id
            : null,
      });
    if (path === "/conversations" && method === "POST") {
      const row = conversation(
        "conversation-new",
        route.request().postDataJSON().title,
      );
      rows.unshift(row);
      return ok(row);
    }
    if (path.endsWith("/feedback")) {
      expect(path).toBe("/requests/request_history_001/feedback");
      feedback = route.request().postDataJSON();
      feedbackCount++;
      return ok({
        ...feedback,
        requestId: "request_history_001",
        updatedAt: now,
      });
    }
    if (path === "/data") {
      expect(method).toBe("DELETE");
      expect(route.request().postDataJSON().confirmation).toBe(
        "DELETE_COACH_DATA",
      );
      allDeleted = true;
      return ok({ status: "ACCEPTED" });
    }
    const row = rows.find((r) => path === `/conversations/${r.id}`);
    if (row && method === "DELETE") {
      deleteCount++;
      if (deleteCount === 1)
        return route.fulfill({ status: 503, json: { message: "temporary" } });
      rows = rows.filter((r) => r.id !== row.id);
      return ok({ status: "ACCEPTED" });
    }
    if (row) {
      const more = url.searchParams.has("cursor");
      return ok({
        conversation: row,
        messages:
          row.id === "conversation-a"
            ? more
              ? [
                  {
                    id: "m2",
                    role: "USER",
                    content: "Second page question",
                    structuredResult: null,
                    createdAt: now,
                  },
                ]
              : [
                  {
                    id: "m1",
                    requestId: "request_history_001",
                    feedback,
                    role: "COACH",
                    content: null,
                    structuredResult: result,
                    createdAt: now,
                  },
                ]
            : [],
        nextCursor: row.id === "conversation-a" && !more ? "m1" : null,
      });
    }
    return route.fulfill({ status: 404, json: { message: "not found" } });
  });
  await page.goto("coach/index");
  await expect(page.getByRole("heading", { name: "历史会话" })).toBeVisible();
  await expect(
    page.getByText(result.explanation, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "加载后续消息" }).click();
  await expect(page.getByText("Second page question")).toBeVisible();
  await page.getByRole("button", { name: "评价这条回答" }).click();
  await page.getByLabel("需要改进", { exact: true }).check();
  await page.getByLabel("反馈原因").selectOption("TOO_HARD");
  await page.getByLabel("补充说明").fill("Please simplify");
  await page.getByRole("button", { name: "提交反馈", exact: true }).click();
  await expect(page.getByText("反馈已保存，谢谢。")).toBeVisible();
  expect(feedbackCount).toBe(1);
  await page.getByRole("button", { name: "加载更多会话" }).click();
  await page.getByRole("button", { name: /^旅行口语/ }).click();
  await expect(page.getByText(result.explanation, { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: /^过去时练习/ }).click();
  await expect(page.getByRole("button", { name: "修改反馈" })).toBeVisible();
  await page.getByRole("button", { name: "修改反馈" }).click();
  await expect(page.getByLabel("补充说明")).toHaveValue("Please simplify");
  await page.getByLabel("新会话名称").fill("新主题");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "新主题", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(result.explanation, { exact: true })).toHaveCount(
    0,
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "删除会话：新主题", exact: true })
    .click();
  await expect(page.getByText("删除失败，会话仍保留，请重试。")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "新主题", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "删除会话：新主题", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "新主题", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "/tmp/en-coach-management.png",
    fullPage: true,
  });
  await page.getByText("Coach 数据管理", { exact: true }).click();
  await page
    .getByRole("button", { name: "删除全部 Coach 数据", exact: true })
    .click();
  await expect(page.getByText(/删除请求已受理/)).toBeVisible();
  expect(allDeleted).toBe(true);
  await expect(
    page.getByRole("button", { name: "新建会话", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByPlaceholder("可以问单词、语法、句子纠错或学习方法…"),
  ).toBeDisabled();
});
