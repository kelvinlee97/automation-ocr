"use strict";

/**
 * settingsStore.js — 运行时可调业务配置
 *
 * 数据持久化到 data/settings.json（docker-compose 已挂载 ./data），
 * 重启不丢失，无需改代码或重新部署。
 *
 * 目前支持的配置项：
 *   - minimum_amount: 最低消费门槛（RM），AI 提取后据此判断 qualified
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR     = path.resolve(__dirname, "../../../../data");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

// 默认值（首次启动或文件不存在时使用）
const DEFAULTS = {
  minimum_amount: 500,
};

function read() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")) };
    }
  } catch {
    // JSON 损坏时降级到默认值
  }
  return { ...DEFAULTS };
}

function write(settings) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

function get(key) {
  return read()[key];
}

function set(key, value) {
  const current = read();
  current[key] = value;
  write(current);
}

function getAll() {
  return read();
}

module.exports = { get, set, getAll };
