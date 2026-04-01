/** @type {import('jest').Config} */
const config = {
  // 匹配项目 CommonJS 风格，不启用 ESM transform
  testEnvironment: 'node',

  // 测试文件约定：src 旁边的 __tests__ 目录，或 .test.js 后缀
  testMatch: [
    '**/src/**/__tests__/**/*.test.js',
    '**/src/**/*.test.js',
  ],

  // 覆盖率收集范围：只统计业务代码，排除入口和配置
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',   // 启动入口，副作用多，不统计
    '!src/bot.js',     // WhatsApp 客户端，依赖外部服务
  ],

  // 覆盖率输出格式
  coverageReporters: ['text', 'lcov'],

  // 单个测试文件超时时间（ms）
  // 设为 10s：handler 测试均为纯函数，超出说明有未 mock 的外部调用
  testTimeout: 10000,

  // 每次测试前自动清除 mock 调用记录，避免用例间污染
  clearMocks: true,

  // 详细输出，方便 CI 日志排查
  verbose: true,
};

module.exports = config;