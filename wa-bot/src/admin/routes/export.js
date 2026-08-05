"use strict";

const { getExcelPath } = require("../../services/excelService");
const logger = require("../../utils/logger");
const { requireAuth } = require("../middleware/auth");
const { getLang, t } = require("../i18n");

function registerExportRoutes(app) {
  app.get("/admin/export", requireAuth, (req, res) => {
    const lang = getLang(req);
    const excelPath = getExcelPath();
    res.download(excelPath, "records.xlsx", (err) => {
      if (err) {
        logger.error("Excel download failed", { error: err.message });
        res.status(500).send(t('download_fail', lang) + err.message);
      }
    });
  });
}

module.exports = { registerExportRoutes };
