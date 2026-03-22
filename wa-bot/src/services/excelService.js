const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const EXCEL_PATH = path.join(__dirname, "../../../data/excel/records.xlsx");

// 确保 Excel 文件存在并初始化表头
async function initExcel() {
  if (!fs.existsSync(path.dirname(EXCEL_PATH))) {
    fs.mkdirSync(path.dirname(EXCEL_PATH), { recursive: true });
  }

  const workbook = new ExcelJS.Workbook();
  if (!fs.existsSync(EXCEL_PATH)) {
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
    ];

    await workbook.xlsx.writeFile(EXCEL_PATH);
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
 * 记录收据识别结果
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
  });

  await workbook.xlsx.writeFile(EXCEL_PATH);
}

module.exports = { initExcel, addRegistration, addReceipt };
