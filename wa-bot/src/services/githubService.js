"use strict";

/**
 * githubService.js — GitHub API integration service
 *
 * Responsibilities: Interact with the GitHub Issues API to create and synchronize feedback issues.
 * Use @octokit/rest (official GitHub SDK).
 */

const logger = require("../utils/logger");

// Environment variables are read at runtime (support dynamic modification during testing)
function getEnv() {
  return {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_REPO_OWNER || "kelvinlee97",
    name: process.env.GITHUB_REPO_NAME || "ClaimFlow",
  };
}

// Octokit instance (lazy loading because @octokit/rest is an ESM module)
let octokit = null;
let octokitPromise = null;

// Injection example for testing
let injectedOctokit = null;

function setTestOctokit(instance) {
  injectedOctokit = instance;
}

async function getOctokit() {
  // Test injection: If a test instance is set, return directly
  if (injectedOctokit) return injectedOctokit;

  if (octokit) return octokit;
  if (octokitPromise) return octokitPromise;

  const env = getEnv();
  octokitPromise = import("@octokit/rest").then(({ Octokit }) => {
    octokit = new Octokit({
      auth: env.token,
      userAgent: "claimflow-feedback",
    });
    return octokit;
  });

  return octokitPromise;
}

/**
 * Create a GitHub Issue
 *
 * @param {object} feedbackData - { id, title, type, description, screenshotUrl, submittedBy, submittedAt }
 * @returns {{ issueId: number, issueUrl: string }}
 */
async function createIssue(feedbackData) {
  const env = getEnv();

  if (!env.token) {
    throw new Error("GITHUB_TOKEN not configured");
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
      labels,
    });

    logger.info("GitHub Issue created successfully", {
      issueId: response.data.id,
      issueNumber: response.data.number,
      issueUrl: response.data.html_url,
    });

    return {
      issueId: response.data.number,
      issueUrl: response.data.html_url,
    };
  } catch (error) {
    logger.error("GitHub Issue creation failed", {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(`GitHub API error: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Get GitHub Issue details
 *
 * @param {number} issueNumber - Issue number
 * @returns {{ state: string, labels: Array }}
 */
async function getIssue(issueNumber) {
  const env = getEnv();

  if (!env.token) {
    throw new Error("GITHUB_TOKEN not configured");
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
    logger.error("Failed to get GitHub Issue", {
      issueNumber,
      error: error.message,
    });
    throw new Error(`GitHub API error: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Synchronize single issue status
 *
 * @param {object} feedback - { id, githubIssueId }
 * @returns {{ status: string, githubIssueState: string }}
 */
async function syncIssueStatus(feedback) {
  if (!feedback.githubIssueId) {
    throw new Error("Feedback is not associated with a GitHub Issue");
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
 * Build Issue Body (Markdown format)
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
