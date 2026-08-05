const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

// Prefer the environment variable DATA_DIR (the production container is injected through docker-compose)
// Fall back to relative paths for local development: __dirname(/app/src/services) up four levels = project root directory/data
// Keep the path policy consistent with receiptStore.js and ensure that the mounted volume path is written
const DATA_DIR   = process.env.DATA_DIR || path.resolve(__dirname, "../../../../data");
const EXCEL_DIR  = path.join(DATA_DIR, "excel");
const EXCEL_PATH = path.join(EXCEL_DIR, "records.xlsx");

// Malaysia time zone (UTC+8), Excel time column is readable by business personnel
const MY_TIMEZONE = "Asia/Kuala_Lumpur";

/**
 * Returns the current Malaysian local time string, format: YYYY-MM-DD HH:mm:ss
 * sv-SE locale outputs exactly this format, no need for manual splicing
 */
function nowMY() {
  return new Date().toLocaleString("sv-SE", { timeZone: MY_TIMEZONE });
}

/**
 * Remove "@c.us" suffix from WhatsApp phone number
 * When writing to Excel, only pure numeric numbers are retained for easy reading and exporting.
 */
function stripWaId(phone) {
  return phone ? phone.replace(/@c\.us$/, "") : phone;
}

// Write operation mutex: prevent concurrent "read → modify → write back" from causing later writes to overwrite first writes (TOCTOU race condition)
// Principle: Each write operation is appended to the end of the previous Promise to form a serial execution chain
// catch swallows errors on purpose: to avoid a single failure causing the entire queue to become permanently stuck.
let writeQueue = Promise.resolve();
function withExcelLock(fn) {
  const result = writeQueue.then(() => fn());
  writeQueue = result.catch(() => {});
  return result;
}

// Ensure that the Excel file exists and initialize the header (including audit columns)
async function initExcel() {
  if (!fs.existsSync(EXCEL_DIR)) {
    fs.mkdirSync(EXCEL_DIR, { recursive: true });
  }

  const workbook = new ExcelJS.Workbook();

  if (!fs.existsSync(EXCEL_PATH)) {
    // File does not exist: Create fresh, including all columns
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
    // The file already exists: check if the audit column is missing, and append it if it is missing
    await workbook.xlsx.readFile(EXCEL_PATH);
    const recSheet = workbook.getWorksheet("Receipts");

    // Use the header row to detect whether the audit column already exists
    const headerRow = recSheet.getRow(1);
    const headers = [];
    headerRow.eachCell((cell) => headers.push(cell.value));

    const needsMigration = !headers.includes("Review Status");
    if (needsMigration) {
      // Get the current maximum column number and add 3 columns
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
 * Record registration information
 */
async function addRegistration(phone, ic) {
  return withExcelLock(async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_PATH);
    const sheet = workbook.getWorksheet("Registrations");

    // Check for duplicates (must be performed within the lock to ensure the latest status is read)
    // Note: ExcelJS does not restore column key metadata after reading xlsx from disk.
    // Dynamically locate the column number through the header string, maintaining the same style as updateReviewStatus.
    // Avoid hard-coding column positions—column order automatically adapts when adjusted.
    const headerRow = sheet.getRow(1);
    const colIndex = {};
    headerRow.eachCell((cell, colNumber) => {
      colIndex[cell.value] = colNumber;
    });
    const icColNum = colIndex["IC Number"];

    let isDuplicate = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      if (icColNum && row.getCell(icColNum).value === ic) isDuplicate = true;
    });

    if (isDuplicate) return { success: false, duplicate: true };

    // addRow uses array form to avoid silently writing blank lines when the key does not exist.
    sheet.addRow([
      sheet.rowCount, // No (including header row)
      nowMY(),
      stripWaId(phone),
      ic,
      "Registered",
    ]);

    await workbook.xlsx.writeFile(EXCEL_PATH);
    return { success: true };
  });
}

/**
 * Record the receipt recognition result, the initial review status is pending
 */
async function addReceipt(data) {
  return withExcelLock(async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_PATH);
    const sheet = workbook.getWorksheet("Receipts");

    // addRow uses array form (in column order) to avoid writing empty rows due to non-persistent keys.
    // Column order: No, Time, Phone, IC Number, Receipt No, Brand, Amount, Qualified,
    //         Reason, Confidence, Review Status, Reviewer Note, Reviewed At
    sheet.addRow([
      sheet.rowCount,
      nowMY(),
      stripWaId(data.phone),
      data.ic,
      data.receipt_no,
      data.brand,
      data.amount,
      data.qualified ? "YES" : "NO",
      data.disqualify_reason || "",
      data.confidence,
      "pending",
      "",
      "",
    ]);

    await workbook.xlsx.writeFile(EXCEL_PATH);
  });
}

/**
 * Read all receipt lines and return a JSON array (for use by the management backend)
 * rowNo starts from 2 (the first row is the header), corresponds to the actual row number of Excel, and is used for subsequent updateReviewStatus positioning
 */
async function getReceipts() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.getWorksheet("Receipts");

  const receipts = [];
  // Get header mapping: column number -> key
  const headerRow = sheet.getRow(1);
  const colKeyMap = {};
  headerRow.eachCell((cell, colNumber) => {
    colKeyMap[colNumber] = cell.value;
  });

  sheet.eachRow((row, rowNumber) => {
    // Skip header row
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
 * Read all registered user rows and return a JSON array (for use by the admin panel)
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
 * Update the review status of the specified row
 * @param {number} rowNo - Excel actual row number (starting from 2, 1 is the header)
 * @param {string} status - 'approved' | 'rejected'
 * @param {string} note - review notes
 */
async function updateReviewStatus(rowNo, status, note) {
  return withExcelLock(async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_PATH);
    const sheet = workbook.getWorksheet("Receipts");

    const row = sheet.getRow(rowNo);

    // Find the index of each column (dynamic search through the table header to avoid hard-coded column numbers)
    const headerRow = sheet.getRow(1);
    const colIndex = {};
    headerRow.eachCell((cell, colNumber) => {
      colIndex[cell.value] = colNumber;
    });

    // Audit column must exist
    if (!colIndex["Review Status"]) {
      throw new Error("Receipts sheet is missing the Review Status column, please reinitialize Excel");
    }

    row.getCell(colIndex["Review Status"]).value = status;
    row.getCell(colIndex["Reviewer Note"]).value = note || "";
    row.getCell(colIndex["Reviewed At"]).value = new Date().toISOString();
    row.commit();

    await workbook.xlsx.writeFile(EXCEL_PATH);

    // Return key information for this row for sending WhatsApp notifications
    return {
      phone: row.getCell(colIndex["Phone"]).value,
      ic: row.getCell(colIndex["IC Number"]).value,
      receipt_no: row.getCell(colIndex["Receipt No"]).value,
      brand: row.getCell(colIndex["Brand"]).value,
      amount: row.getCell(colIndex["Amount (RM)"]).value,
    };
  });
}

/**
 * Returns the absolute path to the Excel file (used by download routing)
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
