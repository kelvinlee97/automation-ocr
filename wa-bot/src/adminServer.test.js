/**
 * API 集成测试
 * 简化版：验证模块可加载、基本结构正确
 */

const vm = require('vm');

/**
 * 从 HTML 中提取所有 <script> 块并验证 JS 语法合法
 * 使用 vm.Script 做静态语法检查，不实际执行代码
 */
function assertScriptSyntax(html, label) {
  const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
  let match;
  let count = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    count++;
    const src = match[1];
    expect(() => new vm.Script(src)).not.toThrow(
      // 失败时显示脚本前 200 字符，便于定位问题
      `${label} 第 ${count} 个 <script> 块 JS 语法错误，开头：\n${src.slice(0, 200)}`
    );
  }
  // 确保实际找到了 script 块（防止 regex 写错导致空跑）
  expect(count).toBeGreaterThan(0);
}

// ── 回归测试：server-side 模板生成的 script 块不得有 JS 语法错误 ─────────────
// 这类 bug 的根因：翻译文本中的单引号会破坏内嵌 JS 字符串语法，
// 用 JSON.stringify() 转义后可完全避免。英文界面最容易触发（含缩写词如 can't）。
describe('HTML 内嵌 script 块语法合法性（回归防御）', () => {
  let mod;

  beforeAll(() => {
    // 设置 NODE_ENV=test 以获取测试专用导出
    process.env.NODE_ENV = 'test';
    // 清除 require 缓存，确保以 test 模式重新加载
    delete require.cache[require.resolve('./adminServer')];
    mod = require('./adminServer');
  });

  test('receiptsPage - 中文界面 script 块无语法错误', () => {
    const html = mod._receiptsPage([], 'zh');
    assertScriptSyntax(html, 'receiptsPage(zh)');
  });

  test('receiptsPage - 英文界面 script 块无语法错误', () => {
    const html = mod._receiptsPage([], 'en');
    assertScriptSyntax(html, 'receiptsPage(en)');
  });

  test('usersPage - 中文界面 script 块无语法错误', () => {
    const html = mod._usersPage([], 'admin', '', 'zh');
    assertScriptSyntax(html, 'usersPage(zh)');
  });

  test('usersPage - 英文界面 script 块无语法错误', () => {
    const html = mod._usersPage([], 'admin', '', 'en');
    assertScriptSyntax(html, 'usersPage(en)');
  });

  test('setupPage - 中文界面 script 块无语法错误', () => {
    const html = mod._setupPage('', 'zh');
    assertScriptSyntax(html, 'setupPage(zh)');
  });

  test('setupPage - 英文界面 script 块无语法错误', () => {
    const html = mod._setupPage('', 'en');
    assertScriptSyntax(html, 'setupPage(en)');
  });
});

// 验证模块可导入
describe('模块加载', () => {
  test('adminServer 可导入', () => {
    expect(() => {
      require('./adminServer');
    }).not.toThrow();
  });

  test('导出正确的接口', () => {
    const mod = require('./adminServer');
    expect(mod).toHaveProperty('startAdminServer');
    expect(mod).toHaveProperty('setClient');
    expect(mod).toHaveProperty('setQR');
    expect(mod).toHaveProperty('setPairingCodeReady');
    expect(typeof mod.startAdminServer).toBe('function');
  });
});

// 验证关键模块依赖可导入
describe('依赖模块', () => {
  test('sessionManager 可导入', () => {
    const mod = require('./sessionManager');
    expect(mod).toHaveProperty('SESSION_STATE');
    expect(mod).toHaveProperty('getOrCreateSession');
  });

  test('excelService 可导入', () => {
    const mod = require('./services/excelService');
    expect(mod).toBeDefined();
    expect(mod).toHaveProperty('getExcelPath');
  });

  test('icParser 可导入', () => {
    const { validateIC } = require('./utils/icParser');
    expect(typeof validateIC).toBe('function');
  });

  test('maskPhone 可导入', () => {
    const { maskPhone } = require('./utils/maskPhone');
    expect(typeof maskPhone).toBe('function');
  });
});

// 验证配置可加载
describe('配置加载', () => {
  test('config.yaml 可解析', () => {
    const fs = require('fs');
    const yaml = require('js-yaml');
    const path = require('path');

    const configPath = path.join(__dirname, '../../config/config.yaml');
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

    expect(config).toHaveProperty('bot');
    expect(config.bot).toHaveProperty('session_timeout_minutes');
    expect(config.bot).toHaveProperty('max_receipts_per_day');
  });
});
