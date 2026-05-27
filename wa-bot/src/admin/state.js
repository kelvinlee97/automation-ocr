"use strict";

const logger = require("../utils/logger");

let _client = null;
let _qrBase64 = null;
let _waConnected = false;
let _pairingCodeReady = false;
let _sessionStore = null;

function setClient(client) {
  _client = client;
  _waConnected = true;
  _qrBase64 = null;
  _pairingCodeReady = false;
  logger.info("WhatsApp client 已注入管理后台");
}

function setQR(base64DataUri) {
  _qrBase64 = base64DataUri;
  _waConnected = false;
}

function setPairingCodeReady(ready) {
  _pairingCodeReady = ready;
}

function setSessionStore(store) {
  _sessionStore = store;
}

function setDisconnected() {
  _waConnected = false;
  _client = null;
  _pairingCodeReady = false;
  logger.info("WhatsApp 已断线，连接状态重置");

  if (_sessionStore) {
    _sessionStore.clear((err) => {
      if (err) {
        logger.error("断线后清空 admin sessions 失败", { error: String(err) });
      } else {
        logger.info("已清空所有 admin sessions（WA 断线触发）");
      }
    });
  }
}

function getClient() {
  return _client;
}

function getQR() {
  return _qrBase64;
}

function isConnected() {
  return _waConnected;
}

function isPairingCodeReady() {
  return _pairingCodeReady;
}

module.exports = {
  setClient,
  setQR,
  setPairingCodeReady,
  setDisconnected,
  setSessionStore,
  getClient,
  getQR,
  isConnected,
  isPairingCodeReady,
};
