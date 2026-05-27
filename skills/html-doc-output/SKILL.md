---
name: html-doc-output
description: Use when producing local HTML artifacts for complex information: long documentation, specs, plans, visual comparisons, code or PR explanations, research reports, prototypes, dashboards, or one-off interactive editors where terminal Markdown would be hard to read, compare, share, or use.
---

# HTML Document Output

## Core Principle

Use local HTML when terminal Markdown is too low-bandwidth for the job. HTML is not just a wrapper for long text; it is a canvas for structure, visual hierarchy, diagrams, comparisons, annotated code, and focused one-off interactions.

When a response would become a long document, dense comparison, visual explanation, or small purpose-built interface, generate a local HTML file instead of pasting the full artifact into the conversation.

## When to Use

Use this skill when the user needs an artifact that is easier to review in a browser than in the terminal:

- Long technical documentation, wiki pages, runbooks, operational guides, deployment guides, migration guides
- Architecture notes, data-flow explainers, state machines, system maps, or workflow diagrams
- Implementation plans, specs, design explorations, or option comparisons
- Side-by-side comparisons of multiple approaches, designs, APIs, trade-offs, or proposals
- Code understanding artifacts: annotated snippets, module maps, call flows, dependency graphs, PR explanations
- Code review artifacts: rendered diffs, inline margin notes, severity coloring, reviewer checklists
- Research reports, incident reports, weekly summaries, investigation findings, or learning explainers
- Design or product prototypes that benefit from layout, animation, visual states, or interactive controls
- One-off editing interfaces for structured data, prompts, configs, ticket triage, annotations, prioritization, or tuning
- Any output likely to be ignored, skimmed poorly, or awkward to understand as terminal text

Treat “around 100+ lines” as a signal, not a strict threshold. Use HTML sooner when visual structure, comparison, or interaction would materially improve comprehension.

## When Not to Use

Do not create HTML when:

- The answer is short enough to read comfortably in the terminal
- The user explicitly asks for inline Markdown, plain text, JSON, CSV, or another non-HTML format
- The user explicitly says not to create files
- The task is a narrow code answer, small explanation, or command snippet
- A quick terminal summary is enough for the decision being made
- The user needs a committed source file, production UI, or reusable app rather than a disposable local artifact

## Choose the Artifact Type

Before writing the file, choose the smallest artifact type that fits the user's goal:

| Type | Use for | Must include |
| --- | --- | --- |
| `document` | Long-form docs, runbooks, guides, specs | TOC, sections, callouts, readable code blocks |
| `comparison` | Multiple options, designs, APIs, approaches | Grid or matrix layout, trade-offs, recommendation, decision criteria |
| `explainer` | Understanding a system, code path, algorithm, incident, or concept | Diagrams, annotated snippets, key takeaways, gotchas |
| `review` | PRs, diffs, code review, technical review | Rendered diff or snippet, inline annotations, severity labels, action list |
| `prototype` | Visual design, UI behavior, animation, layout exploration | Distinct variants or controls, visible states, notes on trade-offs |
| `editor` | Triage, tuning, annotation, config/prompt/data editing | Purpose-built controls, live preview when useful, export/copy action |
| `report` | Research, audits, status, investigation summaries | Executive summary, evidence, tables/charts, recommended next steps |

Do not overbuild. A static `document` is enough for many cases. Use `editor` or interactive controls only when the user needs to manipulate information and bring the result back.

## Output Location and Naming

Save generated documents under the current workspace:

```text
docs/html/<topic-slug>.html
```

Rules:

- Use a short lowercase kebab-case `<topic-slug>` based on the artifact topic.
- Do not prefix the filename with a date.
- Use `.html` extension.
- If `docs/html/` does not exist, create it before writing the file.

Examples:

```text
docs/html/kubernetes-incident-response-runbook.html
docs/html/onboarding-screen-options.html
docs/html/streaming-backpressure-pr-review.html
docs/html/feature-flag-editor.html
```

## HTML Requirements

Generate a standalone HTML file:

- Use `<!doctype html>` and `lang="zh-CN"` by default unless the user asks for another language.
- Include all CSS inline in a `<style>` block.
- Do not depend on external CSS, JavaScript, fonts, CDNs, images, or network resources.
- Prefer semantic HTML: `main`, `header`, `nav`, `section`, `article`, `table`, `figure`, `pre`, `code`, `details`.
- Use inline SVG for diagrams, flows, architecture maps, timelines, or simple charts when it improves clarity.
- Preserve code blocks, commands, tables, warnings, notes, checklists, and source references.
- Include a table of contents for multi-section documents.
- Include a fixed bottom-right “Back to top” button/link for long documents. It should be unobtrusive, accessible, printable-safe, and must not require external JavaScript.
- Keep the style readable in a browser and printable where practical.
- Make layouts responsive enough to read on narrower screens unless the artifact is inherently wide, such as a comparison grid or diff review.

## Interaction Rules

Static HTML is the default. Add inline JavaScript only when interaction directly serves the user's requested task.

Good reasons to use inline JS:

- Filtering, searching, sorting, expanding, or collapsing dense information
- Switching between options, views, examples, or severity levels
- Sliders, knobs, toggles, or live preview for design/prototype tuning
- Dragging, bucketing, tagging, approving/rejecting, or annotating items
- Copy/export buttons that turn user edits into JSON, Markdown, a patch, or a prompt to paste back into the agent

Rules for interactive artifacts:

- Keep all JavaScript inline in the HTML file.
- Do not load external libraries.
- Keep interactions local and transparent; do not send data anywhere.
- Always provide a clear export path when the user can change data: `Copy as JSON`, `Copy as Markdown`, `Copy diff`, or `Copy prompt`.
- Include a short “How to use this artifact” section near the top.
- Do not make the artifact depend on browser storage unless the user explicitly asks.
- Prefer simple controls over app-like complexity.

If interaction would be decorative rather than useful, do not add it.

## Visual Design Guidance

Use visual structure to make the artifact easier to read, compare, and act on:

- Center readable narrative content; use wider layouts only for grids, diagrams, tables, or diffs.
- Use clear heading hierarchy and strong section landmarks.
- Use cards, columns, matrices, timelines, swimlanes, or split panes when they help comparison.
- Use high-contrast code blocks with line numbers or labels when useful.
- Use readable tables with borders, sticky headers when helpful, and alternating backgrounds.
- Use callout blocks for `Note`, `Warning`, `Danger`, `Success`, `Decision`, and `Open Question`.
- Color-code sparingly and always pair color with text labels.
- Make recommendations visually distinct from alternatives.
- Avoid decorative complexity that does not improve understanding.

## Default Structures

### Runbook or Operational Guide

Use this structure unless the user requested another shape:

1. Title and short summary
2. Scope and applicability
3. Background or context
4. Preconditions
5. Inputs, accounts, permissions, or dependencies
6. Step-by-step procedure
7. Validation checks
8. Rollback or recovery plan
9. Troubleshooting guide
10. FAQ or references, if useful

### Comparison or Design Exploration

Use this structure for multiple options:

1. Goal and decision context
2. Decision criteria
3. Side-by-side option grid or matrix
4. Per-option details: what it optimizes for, trade-offs, risks
5. Recommendation and why
6. Open questions or follow-up experiments

### Code or PR Review Artifact

Use this structure for code understanding or review:

1. What changed or what is being explained
2. High-level module/data/control flow diagram
3. Annotated code snippets or rendered diff sections
4. Findings grouped by severity or theme
5. Risks, edge cases, and review checklist
6. Suggested next actions

For diff-heavy artifacts, use consistent visual labels such as `Critical`, `High`, `Medium`, `Low`, and `Info`; pair color with text so findings remain understandable when printed or viewed without color.

### Interactive Editor

Use this structure for one-off tools:

1. Purpose and instructions
2. Editable controls or workspace
3. Live preview, validation, or warnings when useful
4. Export/copy section
5. Notes on assumptions and limitations

## Conversation Reply After Writing

After writing the HTML file, do not repeat the full document in the conversation.

Reply in this concise format:

```markdown
已生成 HTML artifact：

- 文件：`docs/html/<topic-slug>.html`
- 类型：<document | comparison | explainer | review | prototype | editor | report>
- 标题：<artifact title>
- 摘要：
  - <summary point 1>
  - <summary point 2>
  - <summary point 3>

<If interactive:> 使用方式：打开文件后可直接操作；完成后用页面里的 `<Copy ...>` 按钮导出结果。
```

Keep the summary short. Do not paste the full HTML or full Markdown unless the user explicitly asks.

## Common Mistakes

Avoid these mistakes:

- Treating HTML as a thin Markdown wrapper instead of using layout, hierarchy, diagrams, tables, or annotations
- Pasting a 100+ line document into the terminal after deciding it should be HTML
- Creating a linear runbook when the user needs side-by-side comparison
- Creating a static report when the user asked for sorting, tuning, annotation, or exportable edits
- Adding interactive controls without an export/copy path
- Adding decorative JavaScript, animation, or styling that does not serve the user's task
- Using `docs/html/YYYY-MM-DD-<topic-slug>.html`; dates are not part of the naming rule
- Creating separate CSS, JS, or asset files without user approval
- Using external CDN resources, external images, external fonts, or network calls
- Omitting source references for code, diffs, or investigation findings
- Omitting the bottom-right “Back to top” button in long generated HTML documents
- Asking for confirmation every time when the user already requested this automatic behavior
