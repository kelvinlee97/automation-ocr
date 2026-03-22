const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const EXCEL_PATH = path.join(__dirname, "../../../data/excel/records.xlsx");

// 确保 Excel 文件存在并初始化表头（含审核列）
async function initExcel() {
  if (!fs.existsSync(path.dirname(EXCEL_PATH))) {
    fs.mkdirSync(path.dirname(EXCEL_PATH), { recursive: true });
  }

  const workbook = new ExcelJS.Workbook();

  if (!fs.existsSync(EXCEL_PATH)) {
    // 文件不存在：全新创建，包含所有列
    const regSheet = workbook.addWorksheet("Registrations");
    regSheet.columns = [
      { header: "No", key: "no", width: 5 },
      { header: "Time", key: "time", width: 25 },
      { header: "Phone", key: "phone", width: 20 },
      { header: "IC Number", key: "ic", width: 20 },
      { header: "Status", key: "status", width: 10 },
    ];

    const recSheet = workbook.addWorksheet("Receipts");
    recSheet.columns = [
      { header: "No", key: "no", width: 5 },
      { header: "Time", key: "time", width: 25 },
      { header: "Phone", key: "phone", width: 20 },
      { header: "IC Number", key: "ic", width: 20 },
      { header: "Receipt No", key: "receipt_no", width: 20 },
      { header: "Brand", key: "brand", width: 20 },
      { header: "Amount (RM)", key: "amount", width: 15 },
      { header: "Qualified", key: "qualified", width: 10 },
      { header: "Reason", key: "reason", width: 30 },
      { header: "Confidence", key: "confidence", width: 10 },
      { header: "Review Status", key: "review_status", width: 15 },
      { header: "Reviewer Note", key: "reviewer_note", width: 30 },
      { header: "Reviewed At", key: "reviewed_at", width: 25 },
    ];

    await workbook.xlsx.writeFile(EXCEL_PATH);
  } else {
    // 文件已存在：检查是否缺少审核列，若缺则追加
    await workbook.xlsx.readFile(EXCEL_PATH);
    const recSheet = workbook.getWorksheet("Receipts");

    // 用表头行检测审核列是否已存在
    const headerRow = recSheet.getRow(1);
    const headers = [];
    headerRow.eachCell((cell) => headers.push(cell.value));

    const needsMigration = !headers.includes("Review Status");
    if (needsMigration) {
      // 获取当前最大列号，追加 3 列
      const lastCol = recSheet.columnCount;
      recSheet.getColumn(lastCol + 1).header = "Review Status";
      recSheet.getColumn(lastCol + 1).key = "review_status";
      recSheet.getColumn(lastCol + 1).width = 15;
      recSheet.getColumn(lastCol + 2).header = "Reviewer Note";
      recSheet.getColumn(lastCol + 2).key = "reviewer_note";
      recSheet.getColumn(lastCol + 2).width = 30;
      recSheet.getColumn(lastCol + 3).header = "Reviewed At";
      recSheet.getColumn(lastCol + 3).key = "reviewed_at";
      recSheet.getColumn(lastCol + 3).width = 25;

      await workbook.xlsx.writeFile(EXCEL_PATH);
    }
  }
}

/**
 * 记录注册信息
 */
async function addRegistration(phone, ic) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.getWorksheet("Registrations");

  // 检查重复
  const icColumn = sheet.getColumn("ic");
  let isDuplicate = false;
  icColumn.eachCell((cell) => {
    if (cell.value === ic) isDuplicate = true;
  });

  if (isDuplicate) return { success: false, duplicate: true };

  sheet.addRow({
    no: sheet.rowCount,
    time: new Date().toISOString(),
    phone,
    ic,
    status: "Registered",
  });

  await workbook.xlsx.writeFile(EXCEL_PATH);
  return { success: true };
}

/**
 * 记录收据识别结果，初始审核状态为 pending
 */
async function addReceipt(data) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.getWorksheet("Receipts");

  sheet.addRow({
    no: sheet.rowCount,
    time: new Date().toISOString(),
    phone: data.phone,
    ic: data.ic,
    receipt_no: data.receipt_no,
    brand: data.brand,
    amount: data.amount,
    qualified: data.qualified ? "YES" : "NO",
    reason: data.disqualify_reason || "",
    confidence: data.confidence,
    review_status: "pending",
    reviewer_note: "",
    reviewed_at: "",
  });

  await workbook.xlsx.writeFile(EXCEL_PATH);
}

/**
 * 读取所有收据行，返回 JSON 数组（供管理后台使用）
 * rowNo 从 2 开始（第 1 行为表头），与 Excel 实际行号对应，用于后续 updateReviewStatus 定位
 */
async function getReceipts() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.getWorksheet("Receipts");

  const receipts = [];
  // 获取表头映射：列号 -> key
  const headerRow = sheet.getRow(1);
  const colKeyMap = {};
  headerRow.eachCell((cell, colNumber) => {
    colKeyMap[colNumber] = cell.value;
  });

  sheet.eachRow((row, rowNumber) => {
    // 跳过表头行
    if (rowNumber === 1) return;

    const record = { rowNo: rowNumber };
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = colKeyMap[colNumber];
      if (key) record[key] = cell.value ?? "";
    });
    receipts.push(record);
  });

  return receipts;
}

/**
 * 读取所有注册用户行，返回 JSON 数组（供管理后台使用）
 */
async function getRegistrations() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.getWorksheet("Registrations");

  const registrations = [];
  const headerRow = sheet.getRow(1);
  const colKeyMap = {};
  headerRow.eachCell((cell, colNumber) => {
    colKeyMap[colNumber] = cell.value;
  });

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const record = { rowNo: rowNumber };
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = colKeyMap[colNumber];
      if (key) record[key] = cell.value ?? "";
    });
    registrations.push(record);
  });

  return registrations;
}

/**
 * 更新指定行的审核状态
 * @param {number} rowNo - Excel 实际行号（从 2 起，1 为表头）
 * @param {string} status - 'approved' | 'rejected'
 * @param {string} note   - 审核备注
 */
async function updateReviewStatus(rowNo, status, note) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.getWorksheet("Receipts");

  const row = sheet.getRow(rowNo);

  // 找到各列索引（通过表头动态查找，避免硬编码列号）
  const headerRow = sheet.getRow(1);
  const colIndex = {};
  headerRow.eachCell((cell, colNumber) => {
    colIndex[cell.value] = colNumber;
  });

  // 审核列必须存在
  if (!colIndex["Review Status"]) {
    throw new Error("Receipts sheet 缺少 Review Status 列，请重新初始化 Excel");
  }

  row.getCell(colIndex["Review Status"]).value = status;
  row.getCell(colIndex["Reviewer Note"]).value = note || "";
  row.getCell(colIndex["Reviewed At"]).value = new Date().toISOString();
  row.commit();

  await workbook.xlsx.writeFile(EXCEL_PATH);

  // 返回该行关键信息，供发送 WhatsApp 通知使用
  return {
    phone: row.getCell(colIndex["Phone"]).value,
    ic: row.getCell(colIndex["IC Number"]).value,
    receipt_no: row.getCell(colIndex["Receipt No"]).value,
    brand: row.getCell(colIndex["Brand"]).value,
    amount: row.getCell(colIndex["Amount (RM)"]).value,
  };
}

/**
 * 返回 Excel 文件的绝对路径（供下载路由使用）
 */
function getExcelPath() {
  return EXCEL_PATH;
}

module.exports = {
  initExcel,
  addRegistration,
  addReceipt,
  getReceipts,
  getRegistrations,
  updateReviewStatus,
  getExcelPath,
};
