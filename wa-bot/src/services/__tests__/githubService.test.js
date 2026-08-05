"use strict";

/**
 * githubService.test.js — githubService GitHub API integration test
 *
 * Test strategy:
 *  - Use setTestOctokit to inject mock Octokit instance
 *  - Avoid real network requests
 *  - Validation of API call parameters and error handling
 */

// ── Set up the test environment before require githubService ────────────────────────

// Create mock octokit instance
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

// Set environment variables (before require githubService)
process.env.GITHUB_TOKEN = "fake-github-token-for-test";
process.env.GITHUB_REPO_OWNER = "test-owner";
process.env.GITHUB_REPO_NAME = "test-repo";

// Clear the require cache to ensure the latest githubService is used
delete require.cache[require.resolve("../githubService")];
const githubService = require("../githubService");

// Inject mock Octokit instance
githubService.setTestOctokit(mockOctokitInstance);

// ──Testing assistance────────────────────────────────────────────────────────────

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
  // Clear all mock call records
  jest.clearAllMocks();
  mockOctokitInstance.issues.create.mockReset();
  mockOctokitInstance.issues.get.mockReset();
});

// ─── createIssue ────────────────────────────────────────────────────────────────

describe("githubService.createIssue", () => {
  it("Call octokit.issues.create and pass the correct parameters", async () => {
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

  it("Use labels=[bug] when type=bug", async () => {
    const feedback = createFakeFeedback({ type: "bug" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.labels).toEqual(["bug"]);
  });

  it("Use labels=[enhancement] when type=improvement", async () => {
    const feedback = createFakeFeedback({ type: "improvement" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.labels).toEqual(["enhancement"]);
  });

  it("Issue body contains description", async () => {
    const feedback = createFakeFeedback({ description: "Page crashes when filtering" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("Page crashes when filtering");
  });

  it("Issue body contains screenshot URL (when there is a screenshot)", async () => {
    const feedback = createFakeFeedback({
      screenshotUrl: "/uploads/feedback/test.png",
    });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("![Screenshot](/uploads/feedback/test.png)");
  });

  it("Issue body does not contain screenshot section (when there is no screenshot)", async () => {
    const feedback = createFakeFeedback({ screenshotUrl: null });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).not.toContain("## Screenshot");
  });

  it("Issue body contains submittedBy", async () => {
    const feedback = createFakeFeedback({ submittedBy: "admin-kelvin" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("@admin-kelvin");
  });

  it("Issue body contains feedback ID", async () => {
    const feedback = createFakeFeedback({ id: "test-uuid-1234" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("test-uuid-1234");
  });

  it("Return { issueId, issueUrl }", async () => {
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    const result = await githubService.createIssue(feedback);

    expect(result).toEqual({
      issueId: 123,
      issueUrl: "https://github.com/test-owner/test-repo/issues/123",
    });
  });

  it("GitHub API logs info on success", async () => {
    const logger = require("../../utils/logger");
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    expect(logger.info).toHaveBeenCalledWith(
      "GitHub Issue created successfully",
      expect.objectContaining({
        issueId: 123456,
        issueNumber: 123,
        issueUrl: "https://github.com/test-owner/test-repo/issues/123",
      })
    );
  });

  it("GitHub API throws error when it fails (network error)", async () => {
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockRejectedValueOnce(new Error("Network error"));

    await expect(githubService.createIssue(feedback)).rejects.toThrow(
      /GitHub API error/
    );
  });

  it("GitHub API fails (401 Unauthorized) and throws an error containing response data", async () => {
    const feedback = createFakeFeedback();
    const error = new Error("Unauthorized");
    error.response = { data: { message: "Bad credentials" } };
    mockOctokitInstance.issues.create.mockRejectedValueOnce(error);

    await expect(githubService.createIssue(feedback)).rejects.toThrow(
      /Bad credentials/
    );
  });

  it("GitHub API throws an error when it fails (403 Throttling)", async () => {
    const feedback = createFakeFeedback();
    const error = new Error("API rate limit exceeded");
    error.response = { data: { message: "API rate limit exceeded" } };
    mockOctokitInstance.issues.create.mockRejectedValueOnce(error);

    await expect(githubService.createIssue(feedback)).rejects.toThrow(
      /API rate limit exceeded/
    );
  });

  it("GitHub API records error logs when it fails", async () => {
    const logger = require("../../utils/logger");
    const feedback = createFakeFeedback();
    const error = new Error("Server error");
    error.response = { data: { message: "Internal server error" } };
    mockOctokitInstance.issues.create.mockRejectedValueOnce(error);

    try {
      await githubService.createIssue(feedback);
    } catch (e) {
      // ignore errors
    }

    expect(logger.error).toHaveBeenCalledWith(
      "GitHub Issue creation failed",
      expect.objectContaining({
        error: expect.any(String),
        response: expect.any(Object),
      })
    );
  });

  it("Throws an error when GITHUB_TOKEN is not configured", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    // Reload the module to get the latest environment variables
    delete require.cache[require.resolve("../githubService")];
    const freshModule = require("../githubService");

    await expect(freshModule.createIssue(createFakeFeedback())).rejects.toThrow(
      /GITHUB_TOKEN not configured/
    );

    // Restore environment variables and reload the original module
    process.env.GITHUB_TOKEN = originalToken;
    delete require.cache[require.resolve("../githubService")];
    const restoredModule = require("../githubService");
    restoredModule.setTestOctokit(mockOctokitInstance);
  });
});

// ─── getIssue ─────────────────────────────────────────────────────────────────

describe("githubService.getIssue", () => {
  it("Call octokit.issues.get and pass the correct parameters", async () => {
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

  it("Return { state, labels }", async () => {
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

  it("Returns state=open when state=open", async () => {
    const mockResponse = createGitHubIssueGetResponse({ state: "open" });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    const result = await githubService.getIssue(123);

    expect(result.state).toBe("open");
  });

  it("Returns state=closed when state=closed", async () => {
    const mockResponse = createGitHubIssueGetResponse({ state: "closed" });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    const result = await githubService.getIssue(123);

    expect(result.state).toBe("closed");
  });

  it("Throw error when GitHub API fails (issue does not exist)", async () => {
    const error = new Error("Not Found");
    error.response = { data: { message: "Not Found" } };
    mockOctokitInstance.issues.get.mockRejectedValueOnce(error);

    await expect(githubService.getIssue(999)).rejects.toThrow(
      /GitHub API error/
    );
  });

  it("GitHub API records error logs when it fails", async () => {
    const logger = require("../../utils/logger");
    const error = new Error("Not Found");
    error.response = { data: { message: "Not Found" } };
    mockOctokitInstance.issues.get.mockRejectedValueOnce(error);

    try {
      await githubService.getIssue(999);
    } catch (e) {
      // ignore errors
    }

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to get GitHub Issue",
      expect.objectContaining({
        issueNumber: 999,
        error: expect.any(String),
      })
    );
  });
});

// ─── syncIssueStatus ───────────────────────────────────────────────────────────

describe("githubService.syncIssueStatus", () => {
  it("Call getIssue to get the latest status", async () => {
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

  it("Return status=open, githubIssueState=open when state=open", async () => {
    const feedback = { id: "test-id", githubIssueId: 123 };
    const mockResponse = createGitHubIssueGetResponse({ state: "open" });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    const result = await githubService.syncIssueStatus(feedback);

    expect(result).toEqual({
      status: "open",
      githubIssueState: "open",
    });
  });

  it("When state=closed returns status=resolved, githubIssueState=closed", async () => {
    const feedback = { id: "test-id", githubIssueId: 123 };
    const mockResponse = createGitHubIssueGetResponse({ state: "closed" });
    mockOctokitInstance.issues.get.mockResolvedValueOnce(mockResponse);

    const result = await githubService.syncIssueStatus(feedback);

    expect(result).toEqual({
      status: "resolved",
      githubIssueState: "closed",
    });
  });

  it("Throws an error when githubIssueId is null", async () => {
    const feedback = { id: "test-id", githubIssueId: null };

    await expect(githubService.syncIssueStatus(feedback)).rejects.toThrow(
      /Feedback is not associated with a GitHub Issue/
    );
  });

  it("Throws an error when githubIssueId is undefined", async () => {
    const feedback = { id: "test-id", githubIssueId: undefined };

    await expect(githubService.syncIssueStatus(feedback)).rejects.toThrow(
      /Feedback is not associated with a GitHub Issue/
    );
  });

  it("Throw error when GitHub API fails (issue does not exist)", async () => {
    const feedback = { id: "test-id", githubIssueId: 999 };
    const error = new Error("Not Found");
    error.response = { data: { message: "Not Found" } };
    mockOctokitInstance.issues.get.mockRejectedValueOnce(error);

    await expect(githubService.syncIssueStatus(feedback)).rejects.toThrow(
      /GitHub API error/
    );
  });
});

// ─── buildIssueBody indirect test ──────────────────────────────────────────────

describe("githubService.buildIssueBody (tested indirectly via createIssue)", () => {
  it("Contains the ## Feedback Details header", async () => {
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("## Feedback Details");
  });

  it("Contains the **Admin:** line", async () => {
    const feedback = createFakeFeedback({ submittedBy: "admin1" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("**Admin:** @admin1");
  });

  it("Contains the **Submitted At:** line (ISO format)", async () => {
    const submittedAt = new Date("2026-01-10T15:30:00Z").getTime();
    const feedback = createFakeFeedback({ submittedAt });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("**Submitted At:** 2026-01-10T15:30:00.000Z");
  });

  it("Contains the line **Feedback ID:**", async () => {
    const feedback = createFakeFeedback({ id: "my-uuid-123" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("**Feedback ID:** my-uuid-123");
  });

  it("Contains ## Description section", async () => {
    const feedback = createFakeFeedback({ description: "Test description here" });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("## Description");
    expect(callArgs.body).toContain("Test description here");
  });

  it("If you have a screenshot, include the ## Screenshot part and markdown image link", async () => {
    const feedback = createFakeFeedback({
      screenshotUrl: "https://example.com/screenshot.png",
    });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("## Screenshot");
    expect(callArgs.body).toContain("![Screenshot](https://example.com/screenshot.png)");
  });

  it("If there is no screenshot, the ## Screenshot part is not included.", async () => {
    const feedback = createFakeFeedback({ screenshotUrl: null });
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).not.toContain("## Screenshot");
  });

  it("Contains --- separator", async () => {
    const feedback = createFakeFeedback();
    mockOctokitInstance.issues.create.mockResolvedValueOnce(createGitHubIssueResponse());

    await githubService.createIssue(feedback);

    const callArgs = mockOctokitInstance.issues.create.mock.calls[0][0];
    expect(callArgs.body).toContain("---\n\n## Description");
  });
});
