/**
 * Malaysia ID card format verification
 * IC format: XXXXXX-XX-XXXX (12 digits, including hyphens)
 * The first 6 digits: year, month and day of birth (YYMMDD)
 * Middle 2 digits: birth state code
 * Last 4 digits: serial number + gender digit
 */

// Valid Malaysian state codes (01-16 + 21-22 + 60-66 + 71-74 + 82-83)
const VALID_STATE_CODES = new Set([
	'01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
	'11', '12', '13', '14', '15', '16',
	'21', '22',
	'60', '61', '62', '63', '64', '65', '66',
	'71', '72', '73', '74',
	'82', '83',
]);

// Standard IC format regular
const IC_PATTERN = /^(\d{6})-(\d{2})-(\d{4})$/;


/**
 * Verify Malaysian ID number format
 * @param {string} ic - the IC string entered by the user
 * @returns {{ valid: boolean, normalized: string | null, reason: string | null }}
 */
function validateIC(ic) {
	if (!ic || typeof ic !== 'string') {
		return { valid: false, normalized: null, reason: 'Input is empty' };
	}

	// Tolerate missing hyphens in user input and auto-complete
	const cleaned = ic.trim().replace(/\s/g, '');
	const normalized = _normalizeIC(cleaned);

	if (!normalized) {
		return { valid: false, normalized: null, reason: 'Incorrect format, should be XXXXXX-XX-XXXX' };
	}

	const match = IC_PATTERN.exec(normalized);
	if (!match) {
		return { valid: false, normalized: null, reason: 'Incorrect format' };
	}

	const [, birthDate, stateCode] = match;

	// Verify birth date is reasonable
	if (!_isValidBirthDate(birthDate)) {
		return { valid: false, normalized: null, reason: 'Invalid date of birth' };
	}

	// Verify state code
	if (!VALID_STATE_CODES.has(stateCode)) {
		return { valid: false, normalized: null, reason: 'Invalid state code' };
	}

	return { valid: true, normalized, reason: null };
}


/**
 * Automatically add hyphens to 12-digit pure numbers
 * Support input: 123456781234 or 123456-78-1234
 */
function _normalizeIC(input) {
	// Standard format for existing hyphens
	if (IC_PATTERN.test(input)) {
		return input;
	}
	// Pure 12-digit number, hyphen inserted automatically
	if (/^\d{12}$/.test(input)) {
		return `${input.slice(0, 6)}-${input.slice(6, 8)}-${input.slice(8)}`;
	}
	return null;
}


/**
 * Verify that birth date in YYMMDD format is reasonable
 * Years 00-99 (across centuries) are allowed, but months must be 01-12 and dates must be 01-31
 */
function _isValidBirthDate(yymmdd) {
	const mm = parseInt(yymmdd.slice(2, 4), 10);
	const dd = parseInt(yymmdd.slice(4, 6), 10);
	return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}


module.exports = { validateIC };
