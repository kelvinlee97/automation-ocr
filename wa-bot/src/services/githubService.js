"use strict";

/**
 * githubService.js — GitHub API 集成服务
 *
 * 职责：与 GitHub Issues API 交互，创建和同步反馈问题。
 * 使用 @octokit/rest (官方 GitHub SDK)。
 */

const logger = require("../utils/logger");

// 环境变量在运行时读取（支持测试时动态修改）
function getEnv() {
  return {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_REPO_OWNER || "kelvinlee97",
    name: process.env.GITHUB_REPO_NAME || "automation-ocr",
  };
}

// Octokit 实例（懒加载，因为 @octokit/rest 是 ESM 模块）
let octokit = null;
let octokitPromise = null;

// 用于测试的注入实例
let injectedOctokit = null;

function setTestOctokit(instance) {
  injectedOctokit = instance;
}

async function getOctokit() {
  // 测试注入：如果设置了测试实例，直接返回
  if (injectedOctokit) return injectedOctokit;

  if (octokit) return octokit;
  if (octokitPromise) return octokitPromise;

  const env = getEnv();
  octokitPromise = import("@octokit/rest").then(({ Octokit }) => {
    octokit = new Octokit({
      auth: env.token,
      userAgent: "automation-ocr-feedback",
    });
    return octokit;
  });

  return octokitPromise;
}

/**
 * 创建 GitHub Issue
 *
 * @param {object} feedbackData - { id, title, type, description, screenshotUrl, submittedBy, submittedAt }
 * @returns {{ issueId: number, issueUrl: string }}
 */
async function createIssue(feedbackData) {
  const env = getEnv();

  if (!env.token) {
    throw new Error("GITHUB_TOKEN 未配置");
  }

  const { id, title, type, description, screenshotUrl, submittedBy, submittedAt } = feedbackData;

  const issueTitle = `[Feedback] ${title}`;
  const issueBody = buildIssueBody({ description, screenshotUrl, submittedBy, submittedAt, id });
  const labels = type === "bug" ? ["bug"] : ["enhancement"];

  try {
    const octokit = await getOctokit();
    const response = await octokit.issues.create({
      owner: env.owner,
      repo: env.name,
      title: issueTitle,
      body: issueBody,
      labels: labels,
    });

    logger.info("GitHub Issue 创建成功", {
      issueId: response.data.id,
      issueNumber: response.data.number,
      issueUrl: response.data.html_url,
    });

    return {
      issueId: response.data.number,
      issueUrl: response.data.html_url,
    };
  } catch (error) {
    logger.error("GitHub Issue 创建失败", {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(`GitHub API 错误: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * 获取 GitHub Issue 详情
 *
 * @param {number} issueNumber - Issue 编号
 * @returns {{ state: string, labels: Array }}
 */
async function getIssue(issueNumber) {
  const env = getEnv();

  if (!env.token) {
    throw new Error("GITHUB_TOKEN 未配置");
  }

  try {
    const octokit = await getOctokit();
    const response = await octokit.issues.get({
      owner: env.owner,
      repo: env.name,
      issue_number: issueNumber,
    });

    return {
      state: response.data.state, // "open" | "closed"
      labels: response.data.labels.map(l => l.name),
    };
  } catch (error) {
    logger.error("获取 GitHub Issue 失败", {
      issueNumber,
      error: error.message,
    });
    throw new Error(`GitHub API 错误: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * 同步单个 Issue 状态
 *
 * @param {object} feedback - { id, githubIssueId }
 * @returns {{ status: string, githubIssueState: string }}
 */
async function syncIssueStatus(feedback) {
  if (!feedback.githubIssueId) {
    throw new Error("反馈未关联 GitHub Issue");
  }

  const issue = await getIssue(feedback.githubIssueId);

  const githubIssueState = issue.state;
  const status = issue.state === "closed" ? "resolved" : "open";

  return {
    status,
    githubIssueState,
  };
}

/**
 * 构建 Issue Body（Markdown 格式）
 */
function buildIssueBody({ description, screenshotUrl, submittedBy, submittedAt, id }) {
  let body = "## Feedback Details\n\n";
  body += `**Admin:** @${submittedBy}\n`;
  body += `**Submitted At:** ${new Date(submittedAt).toISOString()}\n`;
  body += `**Feedback ID:** ${id}\n\n`;
  body += "---\n\n";
  body += "## Description\n\n";
  body += description + "\n\n";

  if (screenshotUrl) {
    body += "## Screenshot\n\n";
    body += `![Screenshot](${screenshotUrl})\n`;
  }

  return body;
}

module.exports = {
  createIssue,
  getIssue,
  syncIssueStatus,
  setTestOctokit,
};
