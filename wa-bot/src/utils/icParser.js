/**
 * 马来西亚身份证格式验证
 * IC 格式：XXXXXX-XX-XXXX（12位数字，含连字符）
 * 前6位：出生年月日（YYMMDD）
 * 中间2位：出生州代码
 * 后4位：序号+性别位
 */

// 有效的马来西亚州代码（01-16 + 21-22 + 60-66 + 71-74 + 82-83）
const VALID_STATE_CODES = new Set([
	'01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
	'11', '12', '13', '14', '15', '16',
	'21', '22',
	'60', '61', '62', '63', '64', '65', '66',
	'71', '72', '73', '74',
	'82', '83',
]);

// 标准 IC 格式正则
const IC_PATTERN = /^(\d{6})-(\d{2})-(\d{4})$/;


/**
 * 验证马来西亚身份证号格式
 * @param {string} ic - 用户输入的 IC 字符串
 * @returns {{ valid: boolean, normalized: string | null, reason: string | null }}
 */
function validateIC(ic) {
	if (!ic || typeof ic !== 'string') {
		return { valid: false, normalized: null, reason: '输入为空' };
	}

	// 容忍用户输入时遗漏连字符，自动补全
	const cleaned = ic.trim().replace(/\s/g, '');
	const normalized = _normalizeIC(cleaned);

	if (!normalized) {
		return { valid: false, normalized: null, reason: '格式不正确，应为 XXXXXX-XX-XXXX' };
	}

	const match = IC_PATTERN.exec(normalized);
	if (!match) {
		return { valid: false, normalized: null, reason: '格式不正确' };
	}

	const [, birthDate, stateCode] = match;

	// 验证出生日期合理性
	if (!_isValidBirthDate(birthDate)) {
		return { valid: false, normalized: null, reason: '出生日期无效' };
	}

	// 验证州代码
	if (!VALID_STATE_CODES.has(stateCode)) {
		return { valid: false, normalized: null, reason: '州代码无效' };
	}

	return { valid: true, normalized, reason: null };
}


/**
 * 将 12 位纯数字自动补充连字符
 * 支持输入：123456781234 或 123456-78-1234
 */
function _normalizeIC(input) {
	// 已有连字符的标准格式
	if (IC_PATTERN.test(input)) {
		return input;
	}
	// 纯 12 位数字，自动插入连字符
	if (/^\d{12}$/.test(input)) {
		return `${input.slice(0, 6)}-${input.slice(6, 8)}-${input.slice(8)}`;
	}
	return null;
}


/**
 * 验证 YYMMDD 格式的出生日期是否合理
 * 允许年份 00-99（跨世纪），但月份须 01-12，日期须 01-31
 */
function _isValidBirthDate(yymmdd) {
	const yy = parseInt(yymmdd.slice(0, 2), 10);
	const mm = parseInt(yymmdd.slice(2, 4), 10);
	const dd = parseInt(yymmdd.slice(4, 6), 10);
	return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}


module.exports = { validateIC };
