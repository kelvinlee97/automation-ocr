/**
 * API 集成测试
 * 简化版：验证模块可加载、基本结构正确
 */

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