/**
 * WhatsApp Bot initialization module
 * Encapsulates the initialization, QR code display, disconnection and reconnection logic of whatsapp-web.js
 */

const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { handleMessage } = require('./messageHandler');
const logger = require('./utils/logger');

// Maximum number of reconnections after disconnection
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;

// Chromium user data directory, consistent with LocalAuth dataPath
const AUTH_DATA_PATH = '.wwebjs_auth';

/**
 * Clean up Chromium’s legacy Singleton lock files
 * The old SingletonLock/SingletonCookie/SingletonSocket still remains after the container is restarted.
 * In the persistent volume, the new process will think that the profile is occupied by other hosts and refuse to start.
 *
 * LocalAuth directory structure:
 *   clientId not set: <dataPath>/session/
 *   Set clientId: <dataPath>/session-<clientId>/
 * This project does not set a clientId, so the actual path is .wwebjs_auth/session/
 */
function clearChromiumSingletonLocks() {
	// When clientId is not set, LocalAuth uses the "session" directory (no suffix)
	const sessionDir = path.join(AUTH_DATA_PATH, 'session');
	const lockPatterns = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

	for (const name of lockPatterns) {
		const lockPath = path.join(sessionDir, name);
		try {
			fs.unlinkSync(lockPath);
			logger.info(`Cleaned Chromium lock file: ${lockPath}`);
		} catch (err) {
			// ENOENT indicates that the file does not exist, which is a normal situation (first startup or has been cleaned) and does not need to be recorded.
			if (err.code !== 'ENOENT') {
				logger.warn(`Failed to clean lock file: ${lockPath}`, { error: err.message });
			}
		}
	}
}


// Module-level client reference, used by requestPairingCode
// Do not export the client directly to avoid life cycle confusion caused by external references.
let _activeClient = null;

/**
 * Create and launch WhatsApp Bot
 * Use LocalAuth to persist the session, and there is no need to re-scan the code after restarting
 * @param {Object} callbacks
 * @param {Function} [callbacks.onQR] - callback when the QR code is refreshed, the parameter is base64 data URI
 * @param {Function} [callbacks.onReady] - Callback when Bot is ready, the parameter is the client instance
 * @param {Function} [callbacks.onPairingCodeReady] - callback when the client enters the state where the pairing code can be requested (after the qr event is triggered)
 */
async function createBot({ onQR, onReady, onPairingCodeReady, onDisconnected } = {}) {
	// Clean up the residual lock files before each startup to prevent Chromium from being unable to start due to the profile being "occupied" after the container is restarted.
	clearChromiumSingletonLocks();

	const client = new Client({
		authStrategy: new LocalAuth({
			dataPath: AUTH_DATA_PATH,
		}),
		puppeteer: {
			headless: true,
			args: [
				// ── Security/Sandbox (required for container environment)─────────────────────────
				'--no-sandbox',
				'--disable-setuid-sandbox',

				// ── Memory optimization (914MB low memory machine)───────────────────────
				// /dev/shm is only 64MB by default in Docker. Use /tmp instead to avoid crashes due to insufficient shared memory.
				'--disable-dev-shm-usage',
				// Disable GPU process, not needed in headless mode, save ~40MB
				'--disable-gpu',
				// Limit the upper limit of V8 old generation heap. WhatsApp Web does not need to exceed this value for normal operation.
				'--js-flags=--max-old-space-size=128',
				// Keep only one renderer process to avoid doubling the memory when there are multiple tabs
				'--renderer-process-limit=1',
				// Disable unnecessary background functions to reduce background memory usage
				'--disable-background-networking',
				'--disable-default-apps',
				'--disable-extensions',
				'--disable-sync',
				'--metrics-recording-only',
				'--no-first-run',
			],
		},
	});

	// Save to module level for requestPairingCode to use after qr event
	_activeClient = client;

	let reconnectAttempts = 0;
	let isReconnecting = false;

	// QR code scanning (triggered when logging in for the first time or session expires)
	client.on('qr', async (qr) => {
		logger.info('Please scan the QR code to log in to WhatsApp');
		// In the SSH scenario, you can copy this string to a QR generation tool (such as qr.io) and scan the code
		logger.debug('QR data: %s', qr);
		// Convert QR to base64 data URI and inject it into the management backend web page
		if (onQR) {
			try {
				const QRCode = require('qrcode');
				const dataUri = await QRCode.toDataURL(qr);
				onQR(dataUri);
			} catch (err) {
				logger.error('QR code conversion to base64 failed', { error: err.message });
			}
		}

		// The qr event trigger indicates that the client has been initialized and entered the authentication window period. At this time, requestPairingCode can be called.
		// Notify adminServer: Pairing code requests can now be accepted
		if (onPairingCodeReady) onPairingCodeReady();
	});

	// Login successful: Only register message monitoring at this time to avoid processing offline backlog messages synchronized before ready
	client.on('ready', () => {
		reconnectAttempts = 0;
		logger.info('WhatsApp Bot is ready');

		// Record the ready timestamp, used to filter old messages that still arrive after ready
		const readyTimestamp = Date.now() / 1000;

		// Remove the old listener first (ready will be triggered again when disconnected and reconnected) to prevent repeated registration
		client.removeAllListeners('message');
		client.on('message', async (message) => {
			if (message.fromMe) return;
			if (!message.timestamp || message.timestamp < readyTimestamp) return;

			// Obtain the real mobile phone number through the Contact object to avoid the LID (@lid) causing the number to be unreadable
			// Multi-layer fallback strategy, trying to obtain the real mobile phone number layer by layer
			let realPhone = message.from;
			try {
				const contact = await message.getContact();

				// Layer 1: Use contact.number directly (most reliable)
				if (contact?.number) {
					realPhone = contact.number;
				}
				// Layer 2: contact.id._serialized is in @c.us format (real mobile phone number)
				else if (contact?.id?._serialized && contact.id._serialized.endsWith('@c.us')) {
					realPhone = contact.id._serialized.replace('@c.us', '');
					logger.debug('Resolved real phone number from contact.id', { from: message.from, resolved: realPhone });
				}
				// Layer 3: Try to query again via client.getContactById
				else if (client && typeof client.getContactById === 'function') {
					const contactById = await client.getContactById(message.from);
					if (contactById?.number) {
						realPhone = contactById.number;
						logger.debug('Resolved real phone number from getContactById', { from: message.from, resolved: realPhone });
					} else if (contactById?.id?._serialized && contactById.id._serialized.endsWith('@c.us')) {
						realPhone = contactById.id._serialized.replace('@c.us', '');
						logger.debug('Resolved real phone number from getContactById.id', { from: message.from, resolved: realPhone });
					}
				}
			} catch (err) {
				logger.warn('Failed to obtain the real mobile phone number, falling back to message.from', { error: err.message });
			}

			// Final check: If it is still in @lid format, keep the complete suffix for background recognition
			// Do not clip @lid so that adminServer can distinguish between LID and real mobile phone number
			if (!realPhone.includes('@')) {
				// Pure numbers (parsed to real mobile phone numbers), add @c.us suffix to maintain a unified format
				realPhone = `${realPhone}@c.us`;
			}

			await handleMessage(message, realPhone);
		});

		// Notify external (adminServer) client that client is ready
		if (onReady) onReady(client);
	});

	// Authentication failed
	client.on('authenticated', () => {
                logger.info('WhatsApp authentication successful');
        });

        // Authentication failed
        client.on('auth_failure', (msg) => {
		logger.error('WhatsApp authentication failed, please delete the .wwebjs_auth directory and scan the code again', { msg });
	});

	// Disconnection handling: exponential backoff reconnection
	client.on('disconnected', async (reason) => {
		logger.warn('WhatsApp disconnected', { reason, reconnectAttempts });

		// Immediately notify adminServer to reset the connection status and ensure that "Connected" is no longer displayed in the background
		if (onDisconnected) onDisconnected();

		// Prevent the disconnected event from being triggered multiple times causing concurrent reconnection
		if (isReconnecting) {
			logger.warn('A reconnection is already in progress; skipping this event');
			return;
		}

		if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			logger.error('The maximum number of reconnections has been reached. Please restart the service manually.');
			process.exit(1);
		}

		const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts);
		reconnectAttempts++;
		isReconnecting = true;
		logger.info(`Attempting reconnect ${reconnectAttempts} in ${delay / 1000} seconds...`);

		setTimeout(async () => {
			try {
				// You also need to clean up the lock file before disconnecting and reconnecting to prevent residual locks from causing reconnection failure after Chromium exits abnormally.
				clearChromiumSingletonLocks();
				await client.initialize();
			} catch (err) {
				logger.error('Reconnection failed', { error: err.message });
			} finally {
				isReconnecting = false;
			}
		}, delay);
	});

	// Start a WhatsApp connection, triggering QR code generation
	await client.initialize();

	return client;
}

/**
 * Request a pairing code from the connected WhatsApp client
 * Must be called after the qr event is triggered (the client has been initialized but not authenticated)
 * @param {string} phone - a purely numeric mobile phone number including international area code, such as "601234567890"
 * @returns {Promise<string>} 8-digit matching code, such as "WXYZ-ABCD"
 */
async function requestPairingCode(phone) {
	if (!_activeClient) {
		throw new Error('WhatsApp client has not been initialized yet');
	}

	const page = _activeClient.pupPage;

	// requestPairingCode() of whatsapp-web.js is called in page.evaluate()
	// window.onCodeReceivedEvent(code), and directly return its return value as the pairing code.
	// This function is not registered when QR mode is started and must be manually injected before calling.
	//
	// Do not use page.exposeFunction(): it relies on CDP binding, and the injected function is on the browser side
	// is asynchronous (returns a Promise), whereas the library code `return window.onCodeReceivedEvent(...)`
	// Expects synchronous return values, the two are incompatible.
	//
	// Use page.evaluate() to assign values directly on the browser side: pure browser JS execution,
	// The function returns code synchronously, which is completely consistent with the library's calling convention.
	/* eslint-env browser */
	await page.evaluate(() => {
		if (typeof window.onCodeReceivedEvent !== 'function') {
			window.onCodeReceivedEvent = (code) => code;
		}
	});

	// whatsapp-web.js requires the mobile phone number to be a pure numeric string (including international area code)
	const result = await _activeClient.requestPairingCode(phone);

	// Diagnosis: Print the original return value type and content to help determine the internal state of WA
	logger.debug('requestPairingCode raw return value', { type: typeof result, value: String(result).slice(0, 20) });

	// The library will return a short string error code (such as "t") instead of throwing an exception in certain error conditions
	// WhatsApp return format is unstable, sometimes with hyphens (ABCD-1234), sometimes pure 8-bit (ABCD1234)
	// Use regular matching to match the legal pairing code: 8 alphanumeric characters, optional hyphen in the middle
	const PAIRING_CODE_PATTERN = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i;
	if (!result || typeof result !== 'string' || !PAIRING_CODE_PATTERN.test(result)) {
		throw new Error(`Failed to obtain pairing code, WA returns: ${String(result)}`);
	}

	return result;
}


module.exports = { createBot, requestPairingCode };
