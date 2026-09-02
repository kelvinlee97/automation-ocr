"use strict";

const crypto = require("crypto");
const path = require("path");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const logger = require("../../utils/logger");
const state = require("../state");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../../data");
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function createSessionMiddleware(sessionStore) {
  if (!process.env.SESSION_SECRET && !sessionStore) {
    logger.warn("If SESSION_SECRET is not configured, a random value will be used - the cookie signature will become invalid after restarting and the user must log in again");
  }

  const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
  let store = sessionStore || null;

  if (!store) {
    const SESSION_DIR = path.join(DATA_DIR, "admin_sessions");
    try {
      store = new FileStore({
        path: SESSION_DIR,
        ttl: SESSION_TTL_SECONDS,
        retries: 1,
        logFn: (msg) => logger.warn("[session-file-store]", { msg }),
      });
      state.setSessionStore(store);
    } catch (err) {
      logger.error("FileStore initialization failed, please check whether SESSION_DIR is writable", {
        path: SESSION_DIR,
        error: err.message,
      });
      throw err;
    }
  }

  return session({
    store,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: "auto",
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  });
}

module.exports = { createSessionMiddleware, DATA_DIR, SESSION_TTL_SECONDS };
