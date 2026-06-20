"use strict";

/**
 * githubService.test.js — githubService GitHub API 集成测试
 *
 * 测试策略：
 *  - 使用 setTestOctokit 注入 mock Octokit 实例
 *  - 避免真实网络请求
 *  - 验证 API 调用参数和错误处理
 */

// ── 在 require githubService 之前先设置测试环境 ─────────────────────────

// 创建 mock octokit 实例
const mockOctokitInstance = {
  issues: {
    create: jest.fn(),
    get: jest.fn(),
  },
};

// Mock logger
jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

// 设置环境变量（在 require githubService 之前）
process.env.GITHUB_TOKEN = "fake-github-token-for-test";
process.env.GITHUB_REPO_OWNER = "test-owner";
process.env.GITHUB_REPO_NAME = "test-repo";

// 清除 require 缓存，确保使用最新的 githubService
delete require.cache[require.resolve("../githubService")];
const githubService = require("../githubService");

// 注入 mock Octokit 实例
githubService.setTestOctokit(mockOctokitInstance);

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function createFakeFeedback(overrides = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "Test Feedback",
    type: "bug",
    description: "This is a test feedback description",
    screenshotUrl: null,
    submittedBy: "admin-test",
    submittedAt: Date.now(),
    ...overrides,
  };
}

function createGitHubIssueResponse(overrides = {}) {
  return {
    data: {
      id: 123456,
      number: 123,
      state: "open",
      html_url: "https://github.com/test-owner/test-repo/issues/123",
      ...overrides,
    },
  };
}

function createGitHubIssueGetResponse(overrides = {}) {
  return {
    data: {
      id: 123456,
      number: 123,
      state: "open",
      labels: [{ name: "bug" }],
      ...overrides,
    },
  };
}

beforeEach(() => {
  // 清除所有 mock 调用记录
  jest.clearAllMocks();
  mockOctokitInstance.issues.create.mockReset();
  mockOctokitInstance.issues.get.mockReset();
});

// ─── createIssue ────────────────────────────────────────────────────────────────

describe("githubService.createIssue", () => {
  it("调用 octokit.issues.create 并传正确参数", async () => {
    const feedback = createFakeFeedback();
    const mockResponse = createGitHubIssueResponse();
    mockOctokitInstance.issues.create.mockResolvedValueOnce(mockResponse);

    await githubService.createIssue(feedback);

    expect(mockOctokitInstance.issues.create).toHaveBeenCalledTimes(1);
    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs).toMatchObject({
      owner: "test-owner",
      repo: "test-repo",
      title: "[Feedback] Test Feedback",
      body: expect.any(String),
      labels: ["bug"],
    });
  });

  it("type=bug 时使用 labels=[bug]", async () => {
    const feedback = createFakeFeedback({ type: "bug" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.labels).toEqual(["bug"]);
  });

  it("type=improvement 时使用 labels=[enhancement]", async () => {
    const feedback = createFakeFeedback({ type: "improvement" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.labels).toEqual(["enhancement"]);
  });

  it("Issue body 包含 description", async () => {
    const feedback = createFakeFeedback({ description: "Page crashes when filtering" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("Page crashes when filtering");
  });

  it("Issue body 包含 screenshot URL（当有截图时）", async () => {
    const feedback = createFakeFeedback({
      screenshotUrl: "/uploads/feedback/test.png",
    });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("![Screenshot](/uploads/feedback/test.png)");
  });

  it("Issue body 不包含 screenshot section（当无截图时）", async () => {
    const feedback = createFakeFeedback({ screenshotUrl: null });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).not.toContain("## Screenshot");
  });

  it("Issue body 包含 submittedBy", async () => {
    const feedback = createFakeFeedback({ submittedBy: "admin-kelvin" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("@admin-kelvin");
  });

  it("Issue body 包含 feedback ID", async () => {
    const feedback = createFakeFeedback({ id: "test-uuid-1234" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("test-uuid-1234");
  });

  it("返回 { issueId, issueUrl }", async () => {
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    const result = await githubService.createIssue(feedback);

    expect(result).toEqual({
      issueId: 123,
      issueUrl: "https://github.com/test-owner/test-repo/issues/123",
    });
  });

  it("GitHub API 成功时记录 info 日志", async () => {
    const logger = require("../../utils/logger");
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    expect(logger.info).toHaveBeenCalledWith(
      "GitHub Issue 创建成功",
      expect.objectContaining({
        issueId: 123456,
        issueNumber: 123,
        issueUrl: "https://github.com/test-owner/test-repo/issues/123",
      })
    );
  });

  it("GitHub API 失败（网络错误）时抛出错误", async () => {
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockRejectedValueOnce(new Error("Network error"));

    await expect(githubService.createIssue(feedback)).rejects.toThrow(
      /GitHub API 错误/
    );
  });

  it("GitHub API 失败（401 未授权）时抛出错误包含 response data", async () => {
    const feedback = createFakeFeedback();
    const error = new Error("Unauthorized");
    error.response = { data: { message: "Bad credentials" } };
    mockOctokitInstance.issues.create.mockRejectedValueOnce(error);

    await expect(githubService.createIssue(feedback)).rejects.toThrow(
      /Bad credentials/
    );
  });

  it("GitHub API 失败（403 限流）时抛出错误", async () => {
    const feedback = createFakeFeedback();
    const error = new Error("API rate limit exceeded");
    error.response = { data: { message: "API rate limit exceeded" } };
    mockOctokitInstance.issues.create.mockRejectedValueOnce(error);

    await expect(githubService.createIssue(feedback)).rejects.toThrow(
      /API rate limit exceeded/
    );
  });

  it("GitHub API 失败时记录 error 日志", async () => {
    const logger = require("../../utils/logger");
    const feedback = createFakeFeedback();
    const error = new Error("Server error");
    error.response = { data: { message: "Internal server error" } };
    mockOctokitInstance.issues.create.mockRejectedValueOnce(error);

    try {
      await githubService.createIssue(feedback);
    } catch (e) {
      // 忽略错误
    }

    expect(logger.error).toHaveBeenCalledWith(
      "GitHub Issue 创建失败",
      expect.objectContaining({
        error: expect.any(String),
        response: expect.any(Object),
      })
    );
  });

  it("GITHUB_TOKEN 未配置时抛出错误", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    // 重新加载模块以获取最新的环境变量
    delete require.cache[require.resolve("../githubService")];
    const freshModule = require("../githubService");

    await expect(freshModule.createIssue(createFakeFeedback())).rejects.toThrow(
      /GITHUB_TOKEN 未配置/
    );

    // 恢复环境变量并重新加载原模块
    process.env.GITHUB_TOKEN = originalToken;
    delete require.cache[require.resolve("../githubService")];
    const restoredModule = require("../githubService");
    restoredModule.setTestOctokit(mockOctokitInstance);
  });
});

// ─── getIssue ─────────────────────────────────────────────────────────────────

describe("githubService.getIssue", () => {
  it("调用 octokit.issues.get 并传正确参数", async () => {
    const mockResponse = createGitHubIssueGetResponse();
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    await githubService.getIssue(123);

    expect(mockOctokitInstance.issues.get).toHaveBeenCalledTimes(1);
    const callArgs = mockOctokitInstance.issues.get.mock.calls[0][0];
    expect(callArgs).toMatchObject({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
    });
  });

  it("返回 { state, labels }", async () => {
    const mockResponse = createGitHubIssueGetResponse({
      state: "closed",
      labels: [{ name: "bug" }, { name: "priority-high" }],
    });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    const result = await githubService.getIssue(123);

    expect(result).toEqual({
      state: "closed",
      labels: ["bug", "priority-high"],
    });
  });

  it("state=open 时返回 state=open", async () => {
    const mockResponse = createGitHubIssueGetResponse({ state: "open" });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    const result = await githubService.getIssue(123);

    expect(result.state).toBe("open");
  });

  it("state=closed 时返回 state=closed", async () => {
    const mockResponse = createGitHubIssueGetResponse({ state: "closed" });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    const result = await githubService.getIssue(123);

    expect(result.state).toBe("closed");
  });

  it("GitHub API 失败（issue 不存在）时抛出错误", async () => {
    const error = new Error("Not Found");
    error.response = { data: { message: "Not Found" } };
    mockOctokitInstance.issues.get.mockRejectedValueOnce(error);

    await expect(githubService.getIssue(999)).rejects.toThrow(
      /GitHub API 错误/
    );
  });

  it("GitHub API 失败时记录 error 日志", async () => {
    const logger = require("../../utils/logger");
    const error = new Error("Not Found");
    error.response = { data: { message: "Not Found" } };
    mockOctokitInstance.issues.get.mockRejectedValueOnce(error);

    try {
      await githubService.getIssue(999);
    } catch (e) {
      // 忽略错误
    }

    expect(logger.error).toHaveBeenCalledWith(
      "获取 GitHub Issue 失败",
      expect.objectContaining({
        issueNumber: 999,
        error: expect.any(String),
      })
    );
  });
});

// ─── syncIssueStatus ───────────────────────────────────────────────────────────

describe("githubService.syncIssueStatus", () => {
  it("调用 getIssue 获取最新状态", async () => {
    const feedback = { id: "test-id", githubIssueId: 123 };
    const mockResponse = createGitHubIssueGetResponse({ state: "open" });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    await githubService.syncIssueStatus(feedback);

    expect(mockOctokitInstance.issues.get).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
    });
  });

  it("state=open 时返回 status=open, githubIssueState=open", async () => {
    const feedback = { id: "test-id", githubIssueId: 123 };
    const mockResponse = createGitHubIssueGetResponse({ state: "open" });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    const result = await githubService.syncIssueStatus(feedback);

    expect(result).toEqual({
      status: "open",
      githubIssueState: "open",
    });
  });

  it("state=closed 时返回 status=resolved, githubIssueState=closed", async () => {
    const feedback = { id: "test-id", githubIssueId: 123 };
    const mockResponse = createGitHubIssueGetResponse({ state: "closed" });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    const result = await githubService.syncIssueStatus(feedback);

    expect(result).toEqual({
      status: "resolved",
      githubIssueState: "closed",
    });
  });

  it("githubIssueId 为 null 时抛出错误", async () => {
    const feedback = { id: "test-id", githubIssueId: null };

    await expect(githubService.syncIssueStatus(feedback)).rejects.toThrow(
      /反馈未关联 GitHub Issue/
    );
  });

  it("githubIssueId 为 undefined 时抛出错误", async () => {
    const feedback = { id: "test-id", githubIssueId: undefined };

    await expect(githubService.syncIssueStatus(feedback)).rejects.toThrow(
      /反馈未关联 GitHub Issue/
    );
  });

  it("GitHub API 失败（issue 不存在）时抛出错误", async () => {
    const feedback = { id: "test-id", githubIssueId: 999 };
    const error = new Error("Not Found");
    error.response = { data: { message: "Not Found" } };
    mockOctokitInstance.issues.get.mockRejectedValueOnce(error);

    await expect(githubService.syncIssueStatus(feedback)).rejects.toThrow(
      /GitHub API 错误/
    );
  });
});

// ─── buildIssueBody 间接测试 ────────────────────────────────────────────────

describe("githubService.buildIssueBody（通过 createIssue 间接测试）", () => {
  it("包含 ## Feedback Details 标题", async () => {
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("## Feedback Details");
  });

  it("包含 **Admin:** 行", async () => {
    const feedback = createFakeFeedback({ submittedBy: "admin1" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("**Admin:** @admin1");
  });

  it("包含 **Submitted At:** 行（ISO 格式）", async () => {
    const submittedAt = new Date("2026-01-10T15:30:00Z").getTime();
    const feedback = createFakeFeedback({ submittedAt });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("**Submitted At:** 2026-01-10T15:30:00.000Z");
  });

  it("包含 **Feedback ID:** 行", async () => {
    const feedback = createFakeFeedback({ id: "my-uuid-123" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("**Feedback ID:** my-uuid-123");
  });

  it("包含 ## Description 部分", async () => {
    const feedback = createFakeFeedback({ description: "Test description here" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("## Description");
    expect(callArgs.body).toContain("Test description here");
  });

  it("有截图时包含 ## Screenshot 部分和 markdown 图片链接", async () => {
    const feedback = createFakeFeedback({
      screenshotUrl: "https://example.com/screenshot.png",
    });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("## Screenshot");
    expect(callArgs.body).toContain("![Screenshot](https://example.com/screenshot.png)");
  });

  it("无截图时不包含 ## Screenshot 部分", async () => {
    const feedback = createFakeFeedback({ screenshotUrl: null });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).not.toContain("## Screenshot");
  });

  it("包含 --- 分隔线", async () => {
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("---\n\n## Description");
  });
});
