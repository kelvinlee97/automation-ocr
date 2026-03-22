/**
 * 管理后台 Express 服务器
 * 与 Bot 同进程运行，直接共享 WhatsApp client 实例
 * 端口：3000（docker-compose 映射到宿主机 80）
 */

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const {
  getReceipts,
  getRegistrations,
  updateReviewStatus,
  getExcelPath,
} = require("./services/excelService");
const logger = require("./utils/logger");

const ADMIN_PORT = 3000;

// 从环境变量读取认证凭据，缺少时启动即报错（快速失败原则）
function getAdminCredentials() {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    throw new Error(
      "缺少必要环境变量 ADMIN_USER / ADMIN_PASS，请在 .env 或 docker-compose.yml 中配置"
    );
  }
  return { user, pass };
}

// ─── 认证中间件 ────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect("/admin/login");
}

// ─── HTML 片段 ─────────────────────────────────────────────────────────────────

function htmlLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — 管理后台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #f5f7fa; color: #1a1a2e; }
    nav { background: #1a1a2e; color: #fff; padding: 0 24px;
          display: flex; align-items: center; justify-content: space-between; height: 52px; }
    nav a { color: #a8b8d8; text-decoration: none; margin-left: 20px; font-size: 14px; }
    nav a:hover { color: #fff; }
    nav .brand { font-weight: 700; font-size: 16px; color: #fff; letter-spacing: .5px; }
    main { max-width: 1200px; margin: 32px auto; padding: 0 24px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; background: #fff;
            border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    th { background: #f0f4ff; color: #3a4a6b; font-size: 12px; text-transform: uppercase;
         padding: 10px 14px; text-align: left; letter-spacing: .5px; }
    td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; font-size: 13px; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafbff; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px;
             font-size: 11px; font-weight: 600; letter-spacing: .3px; }
    .badge-yes    { background: #e6f9f0; color: #1a7f4e; }
    .badge-no     { background: #fff0f0; color: #c0392b; }
    .badge-pending  { background: #fff8e1; color: #b45309; }
    .badge-approved { background: #e6f9f0; color: #1a7f4e; }
    .badge-rejected { background: #fff0f0; color: #c0392b; }
    .btn { display: inline-block; padding: 5px 12px; border-radius: 6px; font-size: 12px;
           font-weight: 600; cursor: pointer; border: none; text-decoration: none;
           transition: opacity .15s; }
    .btn:hover { opacity: .82; }
    .btn-approve { background: #22c55e; color: #fff; }
    .btn-reject  { background: #ef4444; color: #fff; margin-left: 6px; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-logout  { background: transparent; color: #a8b8d8; border: 1px solid #3a4a6b; }
    form.inline { display: inline; }
    .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
    .empty { text-align: center; padding: 40px; color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <nav>
    <span class="brand">⚙ 管理后台</span>
    <div>
      <a href="/admin/receipts">收据审核</a>
      <a href="/admin/users">注册用户</a>
      <a href="/admin/export">下载 Excel</a>
      <form class="inline" method="POST" action="/admin/logout">
        <button class="btn btn-logout" style="margin-left:20px">退出</button>
      </form>
    </div>
  </nav>
  <main>
    <h1>${title}</h1>
    ${content}
  </main>
</body>
</html>`;
}

// ─── 登录页 ────────────────────────────────────────────────────────────────────

function loginPage(errorMsg = "") {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>登录 — 管理后台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #f5f7fa;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; padding: 40px;
            box-shadow: 0 4px 20px rgba(0,0,0,.10); width: 360px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 28px; text-align: center; color: #1a1a2e; }
    label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px;
            font-size: 14px; margin-bottom: 16px; outline: none; }
    input:focus { border-color: #3b82f6; }
    button { width: 100%; padding: 11px; background: #1a1a2e; color: #fff;
             border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; }
    button:hover { opacity: .88; }
    .error { color: #c0392b; font-size: 13px; margin-bottom: 14px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 管理后台登录</h1>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
    <form method="POST" action="/admin/login">
      <label>用户名</label>
      <input type="text" name="username" required autofocus />
      <label>密码</label>
      <input type="password" name="password" required />
      <button type="submit">登 录</button>
    </form>
  </div>
</body>
</html>`;
}

// ─── 收据列表页 ────────────────────────────────────────────────────────────────

function receiptsPage(receipts) {
  if (receipts.length === 0) {
    return htmlLayout("收据审核", '<div class="empty">暂无收据记录</div>');
  }

  const rows = receipts
    .map((r) => {
      const qualifiedBadge =
        r["Qualified"] === "YES"
          ? '<span class="badge badge-yes">合格</span>'
          : '<span class="badge badge-no">不合格</span>';

      const reviewStatus = r["Review Status"] || "pending";
      const statusBadge = `<span class="badge badge-${reviewStatus}">${
        { pending: "待审核", approved: "已通过", rejected: "已拒绝" }[
          reviewStatus
        ] || reviewStatus
      }</span>`;

      // 已审核的行不再显示操作按钮
      const actions =
        reviewStatus === "pending"
          ? `<form class="inline" method="POST" action="/admin/receipts/${r.rowNo}/review"
                onsubmit="return confirmReview(this, 'approve')">
               <input type="hidden" name="action" value="approved" />
               <input type="hidden" name="note" value="" />
               <button class="btn btn-approve">通过</button>
             </form>
             <form class="inline" method="POST" action="/admin/receipts/${r.rowNo}/review"
                onsubmit="return confirmReview(this, 'reject')">
               <input type="hidden" name="action" value="rejected" />
               <input type="text" name="note" placeholder="拒绝原因（可选）"
                      style="font-size:12px;padding:4px 8px;border:1px solid #ddd;border-radius:4px;width:140px" />
               <button class="btn btn-reject">拒绝</button>
             </form>`
          : `<span style="color:#aaa;font-size:12px">${r["Reviewed At"] || ""}</span>`;

      return `<tr>
      <td>${r.rowNo - 1}</td>
      <td>${r["Time"] || ""}</td>
      <td>${r["Phone"] || ""}</td>
      <td>${r["IC Number"] || ""}</td>
      <td>${r["Receipt No"] || ""}</td>
      <td>${r["Brand"] || ""}</td>
      <td>RM ${r["Amount (RM)"] || ""}</td>
      <td>${qualifiedBadge}</td>
      <td style="max-width:160px;word-break:break-word">${r["Reason"] || ""}</td>
      <td>${statusBadge}</td>
      <td style="max-width:160px;word-break:break-word">${r["Reviewer Note"] || ""}</td>
      <td>${actions}</td>
    </tr>`;
    })
    .join("");

  const content = `
    <div class="toolbar">
      <span style="color:#666;font-size:13px">共 ${receipts.length} 条记录</span>
      <a href="/admin/export" class="btn btn-primary" style="margin-left:auto">⬇ 下载 Excel</a>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th><th>时间</th><th>手机号</th><th>IC 号</th><th>单据号</th>
          <th>品牌</th><th>金额</th><th>AI 判定</th><th>AI 原因</th>
          <th>审核状态</th><th>审核备注</th><th>操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <script>
      function confirmReview(form, type) {
        if (type === 'reject') {
          const note = form.querySelector('input[name="note"]').value;
          return confirm('确认拒绝此收据？' + (note ? '\\n原因：' + note : ''));
        }
        return confirm('确认通过此收据？');
      }
    </script>`;

  return htmlLayout("收据审核", content);
}

// ─── 注册用户列表页 ────────────────────────────────────────────────────────────

function usersPage(registrations) {
  if (registrations.length === 0) {
    return htmlLayout("注册用户", '<div class="empty">暂无注册记录</div>');
  }

  const rows = registrations
    .map(
      (r) => `<tr>
      <td>${r.rowNo - 1}</td>
      <td>${r["Time"] || ""}</td>
      <td>${r["Phone"] || ""}</td>
      <td>${r["IC Number"] || ""}</td>
      <td><span class="badge badge-yes">${r["Status"] || ""}</span></td>
    </tr>`
    )
    .join("");

  const content = `
    <div class="toolbar">
      <span style="color:#666;font-size:13px">共 ${registrations.length} 名用户</span>
    </div>
    <table>
      <thead>
        <tr><th>#</th><th>注册时间</th><th>手机号</th><th>IC 号</th><th>状态</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  return htmlLayout("注册用户", content);
}

// ─── 主函数：启动 Express 服务器 ───────────────────────────────────────────────

function startAdminServer(whatsappClient) {
  // 启动时检查凭据是否已配置
  const credentials = getAdminCredentials();

  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // session 配置：secret 每次启动随机，重启自动清除所有登录态
  app.use(
    session({
      secret: crypto.randomBytes(32).toString("hex"),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000, // 8 小时自动过期
      },
    })
  );

  // ── 路由 ──────────────────────────────────────────────────────────────────

  // 根路径跳转
  app.get("/admin", (req, res) => {
    if (req.session.authenticated) {
      return res.redirect("/admin/receipts");
    }
    res.redirect("/admin/login");
  });

  // 登录页
  app.get("/admin/login", (req, res) => {
    if (req.session.authenticated) return res.redirect("/admin/receipts");
    res.send(loginPage());
  });

  app.post("/admin/login", (req, res) => {
    const { username, password } = req.body;
    if (
      username === credentials.user &&
      password === credentials.pass
    ) {
      req.session.authenticated = true;
      req.session.username = username;
      return res.redirect("/admin/receipts");
    }
    res.send(loginPage("用户名或密码错误，请重试"));
  });

  // 登出
  app.post("/admin/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect("/admin/login");
    });
  });

  // 收据列表
  app.get("/admin/receipts", requireAuth, async (req, res) => {
    try {
      const receipts = await getReceipts();
      res.send(receiptsPage(receipts));
    } catch (err) {
      logger.error("加载收据列表失败", { error: err.message });
      res.status(500).send("加载失败：" + err.message);
    }
  });

  // 审核操作：更新 Excel + 发 WhatsApp 通知
  app.post("/admin/receipts/:rowNo/review", requireAuth, async (req, res) => {
    const rowNo = parseInt(req.params.rowNo, 10);
    const { action, note } = req.body;

    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).send("无效的审核操作");
    }
    if (isNaN(rowNo) || rowNo < 2) {
      return res.status(400).send("无效的行号");
    }

    try {
      const rowData = await updateReviewStatus(rowNo, action, note);
      logger.info("审核操作完成", { rowNo, action, note, phone: rowData.phone });

      // 发送 WhatsApp 通知
      await sendReviewNotification(whatsappClient, action, note, rowData);

      res.redirect("/admin/receipts");
    } catch (err) {
      logger.error("审核操作失败", { error: err.message, rowNo, action });
      res.status(500).send("审核失败：" + err.message);
    }
  });

  // 注册用户列表
  app.get("/admin/users", requireAuth, async (req, res) => {
    try {
      const registrations = await getRegistrations();
      res.send(usersPage(registrations));
    } catch (err) {
      logger.error("加载用户列表失败", { error: err.message });
      res.status(500).send("加载失败：" + err.message);
    }
  });

  // 下载 Excel
  app.get("/admin/export", requireAuth, (req, res) => {
    const excelPath = getExcelPath();
    res.download(excelPath, "records.xlsx", (err) => {
      if (err) {
        logger.error("Excel 下载失败", { error: err.message });
        res.status(500).send("下载失败：" + err.message);
      }
    });
  });

  // ── 启动监听 ──────────────────────────────────────────────────────────────
  app.listen(ADMIN_PORT, () => {
    logger.info(`管理后台已启动，监听端口 ${ADMIN_PORT}`);
  });
}

/**
 * 向用户发送审核结果 WhatsApp 通知
 * whatsapp-web.js 的 chatId 格式：{号码}@c.us
 */
async function sendReviewNotification(client, action, note, rowData) {
  const { phone, receipt_no, brand, amount } = rowData;

  if (!phone) {
    logger.warn("收据行缺少手机号，跳过 WhatsApp 通知");
    return;
  }

  // 补全 chatId 格式，phone 存储格式可能是 "60123456789" 或 "60123456789@c.us"
  const chatId = phone.includes("@") ? phone : `${phone}@c.us`;

  let message;
  if (action === "approved") {
    message =
      `✅ 您的收据已审核通过！\n` +
      `单据号：${receipt_no || "—"} | 品牌：${brand || "—"} | 金额：RM ${amount || "—"}\n` +
      `感谢您的参与！`;
  } else {
    message =
      `❌ 您的收据审核未通过。\n` +
      `原因：${note || "不符合条件"}\n` +
      `如有疑问请重新提交。`;
  }

  try {
    await client.sendMessage(chatId, message);
    logger.info("WhatsApp 通知已发送", { chatId, action });
  } catch (err) {
    // 发送失败不阻断审核流程，记录日志即可
    logger.error("WhatsApp 通知发送失败", { chatId, error: err.message });
  }
}

module.exports = { startAdminServer };
