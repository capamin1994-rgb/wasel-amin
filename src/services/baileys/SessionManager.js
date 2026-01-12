const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const networkOptimizer = require('./NetworkOptimizer');

class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.qrCodes = new Map();
        this.cleanupInProgress = new Set(); // Track sessions being cleaned up to avoid races
        this.removedSessions = new Set(); // Track explicitly removed sessions to stop reconnection loops
        this.reconnectTimers = new Map();
        this.corruptionState = new Map();
        this.authDir = path.join(__dirname, '../../auth_sessions');

        // Create auth directory if it doesn't exist
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }
    }

    /**
     * Handle corrupted session cleanup
     */
    async handleSessionCorruption(sessionId, onDisconnected, callbacks = {}) {
        if (this.cleanupInProgress.has(sessionId)) return;
        this.cleanupInProgress.add(sessionId);

        const now = Date.now();
        const prev = this.corruptionState.get(sessionId) || { count: 0, firstAt: now, lastAt: 0 };
        const windowMs = 15 * 60 * 1000;
        const state = (now - prev.firstAt > windowMs)
            ? { count: 0, firstAt: now, lastAt: 0 }
            : prev;
        state.count += 1;
        state.lastAt = now;
        this.corruptionState.set(sessionId, state);

        console.error(`🚨 Fatal cryptographic error (Bad MAC/Decryption Failure) for session ${sessionId}. Safe restart attempt ${state.count}/3.`);
        networkOptimizer.recordEvent(sessionId, 'fatal_error');

        try {
            await this.softResetSession(sessionId);

            if (state.count >= 3) {
                const sessionPath = path.join(this.authDir, sessionId);
                const quarantineRoot = path.join(this.authDir, '_quarantine');
                const quarantinePath = path.join(quarantineRoot, `${sessionId}_${now}`);
                try {
                    if (!fs.existsSync(quarantineRoot)) fs.mkdirSync(quarantineRoot, { recursive: true });
                    if (fs.existsSync(sessionPath)) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        fs.renameSync(sessionPath, quarantinePath);
                    }
                } catch (e) { }
            }

            if (state.count < 3) {
                const retryCount = (callbacks.retryCount || 0) + 1;
                const delay = Math.min(5000 * retryCount, 30000);
                const t = setTimeout(() => {
                    this.createSession(sessionId, {
                        ...callbacks,
                        isNew: false,
                        retryCount
                    }).catch(() => { });
                }, delay);
                this.reconnectTimers.set(sessionId, t);
            }

            if (onDisconnected) {
                onDisconnected({ error: new Error(state.count >= 3 ? 'Session needs re-link. Please scan QR again.' : 'Session recovering from encryption desync...') });
            }
        } finally {
            // Give some time before allowing another cleanup of the same ID
            setTimeout(() => this.cleanupInProgress.delete(sessionId), 5000);
        }
    }

    async softResetSession(sessionId) {
        try {
            if (this.reconnectTimers.has(sessionId)) {
                clearTimeout(this.reconnectTimers.get(sessionId));
                this.reconnectTimers.delete(sessionId);
            }
            if (this.sessions.has(sessionId)) {
                const sock = this.sessions.get(sessionId);
                try { sock.end(undefined); } catch (e) { }
                this.sessions.delete(sessionId);
            }
            if (this.qrCodes.has(sessionId)) {
                this.qrCodes.delete(sessionId);
            }
            networkOptimizer.cleanup(sessionId);
        } catch (e) { }
    }

    /**
     * Create or restore a WhatsApp session
     * @param {string} sessionId - Unique identifier for the session
     * @param {Function} onQR - Callback when QR code is generated
     * @param {Function} onConnected - Callback when connected
     * @param {Function} onDisconnected - Callback when disconnected
     */
    async createSession(sessionId, callbacks = {}) {
        try {
            const { onQR, onConnected, onDisconnected, onMessage } = callbacks;

            // Clear from removedSessions when starting a new connection attempt
            if (!callbacks.retryCount) {
                this.removedSessions.delete(sessionId);
            }

            // Check if session already exists and is connected
            if (this.sessions.has(sessionId) && this.isConnected(sessionId)) {
                console.log(`Session ${sessionId} already connected`);
                return this.sessions.get(sessionId);
            }

            const sessionPath = path.join(this.authDir, sessionId);

            // Only cleanup if explicitly requested and session is not connected
            if (callbacks.isNew && !this.isConnected(sessionId)) {
                console.log(`Cleaning up disconnected session ${sessionId}`);
                await this.removeSession(sessionId);
            }

            // Create session directory
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
            }

            // Load auth state with error handling
            let state, saveCreds;
            try {
                console.log(`[SessionManager] Step 1: Loading auth state for ${sessionId}`);
                const authResult = await useMultiFileAuthState(sessionPath);
                state = authResult.state;
                saveCreds = authResult.saveCreds;

                // Check if we have valid credentials
                if (state && state.creds && state.creds.me) {
                    console.log(`[SessionManager] Valid credentials found for ${sessionId} (${state.creds.me.name || 'Unknown'})`);
                } else if (state && state.creds && state.creds.signedIdentityKey) {
                    console.log(`[SessionManager] Found signedIdentityKey for ${sessionId}, but 'me' is missing. Trying to connect...`);
                } else {
                    console.log(`[SessionManager] No active credentials for ${sessionId}, will require QR`);
                    // If this is a restore operation (not new), this is unexpected.
                    if (!callbacks.isNew) {
                        console.warn(`[SessionManager] ⚠️ Warning: Session ${sessionId} is missing credentials during restore.`);
                    }
                }
            } catch (authError) {
                console.error(`[SessionManager] ❌ Auth state error for ${sessionId}:`, authError.message);

                if (callbacks.isNew) {
                    console.log(`Cleaning up corrupted session ${sessionId} for new connection...`);
                    if (fs.existsSync(sessionPath)) {
                        fs.rmSync(sessionPath, { recursive: true, force: true });
                        fs.mkdirSync(sessionPath, { recursive: true });
                    }
                    // Retry for new session
                    const authResult = await useMultiFileAuthState(sessionPath);
                    state = authResult.state;
                    saveCreds = authResult.saveCreds;
                } else {
                    // For existing sessions, re-throw or handle gracefully
                    // Don't delete immediately, let the user decide or try to recover
                    throw new Error(`Failed to load auth state for ${sessionId}: ${authError.message}`);
                }
            }

            // Get latest Baileys version with enhanced caching
            let version;
            let isLatest = false;
            try {
                console.log(`[SessionManager] Step 2: Fetching latest Baileys version`);
                const result = await fetchLatestBaileysVersion();
                version = result.version;
                isLatest = result.isLatest;
                console.log(`[SessionManager] Step 2: Using Baileys version: ${version.join('.')}`);
            } catch (versionError) {
                console.warn('Using fallback Baileys version due to fetch error:', versionError.message);
                version = [2, 3000, 1015901307]; // Fallback to stable version
            }

            // Get optimal settings from network optimizer
            console.log(`[SessionManager] Step 3: Getting optimal settings`);
            const optimalSettings = networkOptimizer.getOptimalSettings();

            // Start monitoring this session
            networkOptimizer.startMonitoring(sessionId);

            // Custom logger to intercept internal Baileys/Libsignal errors
            const logger = pino({
                level: 'debug', // Capture more logs to catch the error
                timestamp: () => `,"time":"${new Date().toISOString()}"`
            }, {
                write: (msg) => {
                    const msgStr = msg.toString();
                    const isNoisyDecrypt =
                        msgStr.includes('failed to decrypt message') ||
                        msgStr.includes('No matching sessions found') ||
                        msgStr.includes('Failed to decrypt message with any known session') ||
                        msgStr.includes('Session error:Error: Bad MAC') ||
                        msgStr.includes('Closing open session in favor of incoming prekey bundle') ||
                        msgStr.includes('Closing session:');
                    if (isNoisyDecrypt) return;

                    // Only print errors or fatal logs to terminal to avoid noise, unless it's the specific error we are looking for
                    const levelMatch = msgStr.match(/"level":(\d+)/);
                    if (levelMatch && parseInt(levelMatch[1]) >= 50) { // 50 is ERROR, 60 is FATAL
                        process.stdout.write(msg);
                    }
                }
            });

            // Create socket with enhanced security and stability
            const sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: logger,
                browser: ['Mac OS', 'Chrome', '114.0.5735.198'],
                syncFullHistory: false,
                markOnlineOnConnect: true, // Ensure online status for visibility
                generateHighQualityLinkPreview: false, // Security improvement
                qrTimeout: 60000, // 1 minute QR timeout
                connectTimeoutMs: 60000, // 1 minute connection timeout
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000, // 30 seconds keep alive
                retryRequestDelayMs: 2000,
                maxMsgRetryCount: 5,
                getMessage: async (key) => {
                    return { conversation: '' };
                }
            });

            // Store session immediately so isConnected/getSession can find it during initialization
            this.sessions.set(sessionId, sock);

            // Handle connection updates
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                // QR Code generated with enhanced security
                if (qr) {
                    console.log(`QR Code generated for session: ${sessionId}`);

                    // Generate secure QR code
                    const qrDataURL = await qrcode.toDataURL(qr, {
                        errorCorrectionLevel: 'H', // High error correction
                        type: 'image/png',
                        quality: 0.95,
                        margin: 2,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        },
                        width: 300
                    });

                    this.qrCodes.set(sessionId, qrDataURL);

                    if (onQR) {
                        onQR(qrDataURL, qr);
                    }
                }

                // Connection closed
                if (connection === 'close') {
                    networkOptimizer.recordEvent(sessionId, 'failure');

                    const statusCode = (lastDisconnect?.error instanceof Boom)
                        ? lastDisconnect.error.output.statusCode
                        : null;
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                    const shouldReconnect = !isLoggedOut;

                    // Enhanced retry logic with exponential backoff
                    const isBadMac = lastDisconnect.error?.message?.includes('Bad MAC') ||
                        lastDisconnect.error?.toString().includes('Bad MAC');

                    if (isBadMac) {
                        await this.handleSessionCorruption(sessionId, onDisconnected, callbacks);
                        return; // Stop reconnection loop
                    }

                    console.log(`Connection closed for ${sessionId}. Reconnect:`, shouldReconnect);

                    if (this.reconnectTimers.has(sessionId)) {
                        clearTimeout(this.reconnectTimers.get(sessionId));
                        this.reconnectTimers.delete(sessionId);
                    }

                    if (this.removedSessions.has(sessionId)) {
                        if (onDisconnected) {
                            onDisconnected(lastDisconnect);
                        }
                        return;
                    }

                    if (isLoggedOut) {
                        console.log(`Session ${sessionId} logged out - marking as disconnected`);
                        // Don't auto-delete - user might want to reconnect
                        // Just mark as disconnected in the callbacks
                        if (onDisconnected) {
                            onDisconnected(lastDisconnect);
                        }
                        return;
                    }

                    if (shouldReconnect) {
                        const retryCount = (callbacks.retryCount || 0) + 1;

                        // For new sessions (QR scan), limit retries. For restored sessions, retry indefinitely (max 10000)
                        const maxRetries = callbacks.isNew ? 5 : 10000;

                        if (retryCount <= maxRetries) {
                            networkOptimizer.recordEvent(sessionId, 'reconnect');
                            const maxDelay = callbacks.isNew ? 30000 : 120000;
                            const baseDelay = Math.min(5000 * Math.pow(2, retryCount - 1), maxDelay);
                            const retryDelay = networkOptimizer.shouldAttemptConnection(sessionId)
                                ? baseDelay
                                : Math.max(60000, baseDelay);

                            console.log(`[SessionManager] Attempting reconnection ${retryCount}/${maxRetries} for ${sessionId} in ${retryDelay}ms`);
                            const t = setTimeout(() => {
                                this.createSession(sessionId, {
                                    ...callbacks,
                                    retryCount
                                });
                            }, retryDelay);
                            this.reconnectTimers.set(sessionId, t);
                        } else {
                            console.log(`Max reconnection attempts reached for ${sessionId}`);
                        }
                    }

                    if (onDisconnected) {
                        onDisconnected(lastDisconnect);
                    }
                }

                // Connection opened
                if (connection === 'open') {
                    console.log(`✅ Session ${sessionId} connected successfully`);
                    this.qrCodes.delete(sessionId);

                    if (onConnected) {
                        const phoneNumber = sock.user?.id?.split(':')[0];
                        onConnected({
                            sessionId,
                            phoneNumber,
                            name: sock.user?.name,
                            device: sock.user?.device
                        });
                    }
                }
            });

            // Save credentials when updated
            sock.ev.on('creds.update', saveCreds);

            // Handle incoming messages (optional)
            if (onMessage) {
                sock.ev.on('messages.upsert', async ({ messages, type }) => {
                    if (type === 'notify') {
                        for (const msg of messages) {
                            if (!msg.key.fromMe) {
                                try {
                                    onMessage(msg);
                                } catch (msgError) {
                                    // Ignore decryption errors silently
                                    if (!msgError.message?.includes('Bad MAC')) {
                                        console.error('Message handling error:', msgError);
                                    }
                                }
                            }
                        }
                    }
                });
            }

            return sock;

        } catch (error) {
            console.error(`Error creating session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Request a pairing code for phone number linking
     * @param {string} sessionId
     * @param {string} phoneNumber
     */
    async requestPairingCode(sessionId, phoneNumber) {
        const sock = this.sessions.get(sessionId);
        if (!sock) {
            throw new Error('Session not found or not initialized');
        }
        if (this.isConnected(sessionId)) {
            throw new Error('Session already connected');
        }

        console.log(`[PairingCode] Requesting pairing code for ${sessionId} with phone ${phoneNumber}`);

        try {
            // Normalize phone number - remove all non-digits
            let cleanPhone = phoneNumber.replace(/\D/g, '');

            // Handle Egyptian numbers starting with 0020 or 20
            if (cleanPhone.startsWith('0020')) {
                cleanPhone = cleanPhone.substring(2);
            }

            // Fix double zeros in local format: 20010... -> 2010...
            if (cleanPhone.startsWith('200')) {
                cleanPhone = '20' + cleanPhone.substring(3);
            }

            // Auto-normalize local format: 010... -> 2010...
            if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
                cleanPhone = '20' + cleanPhone.substring(1);
            } else if (cleanPhone.length === 10 && /^(10|11|12|15)/.test(cleanPhone)) {
                // Short local: 10... -> 2010...
                cleanPhone = '20' + cleanPhone;
            }

            if (cleanPhone.length < 10) {
                throw new Error('رقم الهاتف غير صحيح. يرجى التأكد من كتابته بالصيغة الدولية الصحيحة بدون + أو أصفار زائدة.');
            }

            console.log(`[PairingCode] Requesting code for: ${cleanPhone}`);

            // Wait for socket to be ready - pairing code works when connection is 'close'
            // We need to wait for the socket to be in a stable state
            // For pairing code, the socket should be OPEN but connection should be 'close'
            let retries = 0;
            const maxRetries = 30; // Increased retries for better reliability
            let socketReady = false;

            console.log(`[PairingCode] Waiting for socket to be ready...`);

            while (retries < maxRetries && !socketReady) {
                const wsState = sock.ws?.readyState;

                // Check if we can access the requestPairingCode method
                if (typeof sock.requestPairingCode === 'function') {
                    // Socket is ready if it's OPEN (1) or CONNECTING (0)
                    // For pairing code, socket should be OPEN
                    if (wsState === 1) { // OPEN
                        socketReady = true;
                        console.log(`[PairingCode] Socket is OPEN and ready`);
                        break;
                    } else if (wsState === 0) { // CONNECTING
                        console.log(`[PairingCode] Socket is CONNECTING, waiting...`);
                        await new Promise(resolve => setTimeout(resolve, 200));
                    } else if (wsState === 3) { // CLOSED
                        console.log(`[PairingCode] Socket is CLOSED, this is OK for pairing code`);
                        // For pairing code, closed socket might be OK, but we prefer OPEN
                        await new Promise(resolve => setTimeout(resolve, 200));
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                } else {
                    console.warn(`[PairingCode] requestPairingCode method not available yet`);
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                retries++;
            }

            if (!socketReady) {
                console.warn(`[PairingCode] Socket not fully ready after ${maxRetries} attempts, but proceeding anyway...`);
            }

            // Additional wait to ensure socket is fully initialized and ready for pairing
            // This is important for Baileys to properly send the notification
            console.log(`[PairingCode] Waiting additional 3 seconds for socket to stabilize...`);
            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log(`[PairingCode] Requesting code for phone: ${cleanPhone}`);
            console.log(`[PairingCode] Socket state: ${sock.ws?.readyState}`);
            console.log(`[PairingCode] User ID: ${sock.user?.id || 'not set'}`);

            // Request pairing code from Baileys
            // This should automatically send a notification to WhatsApp on the provided phone number
            // The notification will appear in WhatsApp asking the user to link the device
            const code = await sock.requestPairingCode(cleanPhone);

            if (!code) {
                throw new Error('Failed to generate pairing code - no code returned');
            }

            console.log(`[PairingCode] ✅ Successfully generated code for ${sessionId}: ${code}`);
            console.log(`[PairingCode] 📱 Notification should be sent to WhatsApp for phone: ${cleanPhone}`);
            console.log(`[PairingCode] 💡 The user should see a notification on their WhatsApp asking to link the device`);
            console.log(`[PairingCode] 📲 User needs to: 1) Open the notification, 2) Tap "Confirm", 3) Enter the code: ${code}`);

            return code;
        } catch (error) {
            console.error(`[PairingCode] ❌ Error for ${sessionId}:`, error.message);
            console.error(`[PairingCode] Error stack:`, error.stack);
            console.error(`[PairingCode] Error details:`, {
                name: error.name,
                message: error.message,
                code: error.code,
                phone: phoneNumber
            });

            // Provide more helpful error messages
            if (error.message.includes('not found') || error.message.includes('not initialized')) {
                throw new Error('الجلسة غير مهيأة. يرجى إعادة المحاولة بعد إنشاء الجلسة.');
            } else if (error.message.includes('already connected')) {
                throw new Error('الجلسة متصلة بالفعل.');
            } else if (error.message.includes('timeout')) {
                throw new Error('انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى.');
            } else if (error.message.includes('Invalid phone')) {
                throw new Error('رقم الهاتف غير صحيح. استخدم الصيغة الدولية بدون +');
            }

            throw new Error(`فشل في توليد كود الربط: ${error.message}`);
        }
    }

    /**
     * Get existing session
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    /**
     * Get QR code for session
     */
    getQRCode(sessionId) {
        return this.qrCodes.get(sessionId);
    }

    /**
     * Check if session is connected
     */
    isConnected(sessionId) {
        const session = this.sessions.get(sessionId);
        return !!(session && session.user);
    }

    /**
     * Get session info
     */
    getSessionInfo(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.user) {
            return null;
        }

        return {
            sessionId,
            phoneNumber: session.user.id?.split(':')[0],
            name: session.user.name,
            connected: true
        };
    }

    /**
     * Remove session
     */
    async removeSession(sessionId) {
        try {
            this.removedSessions.add(sessionId);
            if (this.reconnectTimers.has(sessionId)) {
                clearTimeout(this.reconnectTimers.get(sessionId));
                this.reconnectTimers.delete(sessionId);
            }

            if (this.sessions.has(sessionId)) {
                const sock = this.sessions.get(sessionId);
                sock.end(undefined); // Close connection
                this.sessions.delete(sessionId);
            }

            if (this.qrCodes.has(sessionId)) {
                this.qrCodes.delete(sessionId);
            }

            // Clean up network optimizer metrics
            networkOptimizer.cleanup(sessionId);

            const sessionPath = path.join(this.authDir, sessionId);
            if (fs.existsSync(sessionPath)) {
                // Wait a bit for file locks to release
                await new Promise(resolve => setTimeout(resolve, 1000));
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }

            console.log(`Session ${sessionId} removed`);
        } catch (error) {
            console.error(`Error removing session ${sessionId}:`, error);
        }
    }

    /**
     * Get all active sessions
     */
    getAllSessions() {
        const sessions = [];
        for (const [sessionId, sock] of this.sessions.entries()) {
            sessions.push({
                sessionId,
                connected: sock.user ? true : false,
                phoneNumber: sock.user?.id?.split(':')[0],
                name: sock.user?.name
            });
        }
        return sessions;
    }

    /**
     * Disconnect session without removing
     */
    async disconnectSession(sessionId) {
        this.removedSessions.add(sessionId);
        if (this.reconnectTimers.has(sessionId)) {
            clearTimeout(this.reconnectTimers.get(sessionId));
            this.reconnectTimers.delete(sessionId);
        }
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.end();
            this.sessions.delete(sessionId);
            console.log(`Session ${sessionId} disconnected`);
        }
    }

    /**
     * Start periodic health check for sessions
     */
    startHealthCheck() {
        if (this.healthCheckInterval) return;

        console.log('[SessionManager] Starting session health check (every 5 minutes)...');
        // Run every 5 minutes
        this.healthCheckInterval = setInterval(async () => {
            try {
                const { db } = require('../../database/db');
                const sessions = await db.all('SELECT session_id, connected FROM whatsapp_sessions');

                for (const session of sessions) {
                    // If session should be connected but isn't in memory or has no user
                    if (!this.isConnected(session.session_id) && !this.removedSessions.has(session.session_id)) {
                        console.log(`[SessionManager-Health] Session ${session.session_id} found disconnected. Attempting revival...`);

                        // Check if files exist
                        const sessionPath = path.join(this.authDir, session.session_id);
                        if (fs.existsSync(sessionPath) && fs.existsSync(path.join(sessionPath, 'creds.json'))) {
                            this.createSession(session.session_id, {
                                isNew: false,
                                onConnected: async () => {
                                    console.log(`✅ [SessionManager-Health] Session ${session.session_id} revived`);
                                    await db.run('UPDATE whatsapp_sessions SET connected = 1, last_connected = ? WHERE session_id = ?',
                                        [new Date().toISOString(), session.session_id]);
                                }
                            }).catch(err => console.error(`[SessionManager-Health] Failed to revive ${session.session_id}:`, err.message));
                        } else {
                            console.log(`[SessionManager-Health] Session ${session.session_id} files missing. Marking as disconnected.`);
                            await db.run('UPDATE whatsapp_sessions SET connected = 0 WHERE session_id = ?', [session.session_id]);
                            await db.run('UPDATE islamic_reminders_config SET session_id = NULL WHERE session_id = ?', [session.session_id]);
                        }
                    }
                }
            } catch (error) {
                console.error('[SessionManager-Health] Error:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Restore all sessions from database
     */
    async restoreAllSessions() {
        try {
            const { db } = require('../../database/db');
            console.log('🔄 [SessionManager] Deep-restoring WhatsApp sessions from database...');

            const sessions = await db.all('SELECT * FROM whatsapp_sessions');
            console.log(`[SessionManager] Found ${sessions.length} sessions in DB to evaluate`);
            if (sessions.length) {
                await db.run('UPDATE whatsapp_sessions SET connected = 0');
            }

            for (const session of sessions) {
                const sessionPath = path.join(this.authDir, session.session_id);
                const hasFolder = fs.existsSync(sessionPath);
                const hasCreds = hasFolder && fs.existsSync(path.join(sessionPath, 'creds.json'));

                console.log(`[SessionManager] Evaluating ${session.session_id}: Folder=${hasFolder}, Creds=${hasCreds}`);

                if (!hasCreds) {
                    console.log(`[SessionManager] Skipping ${session.session_id} - No active credentials found on disk`);
                    try {
                        await db.run('UPDATE whatsapp_sessions SET connected = 0 WHERE session_id = ?', [session.session_id]);
                        await db.run('UPDATE islamic_reminders_config SET session_id = NULL WHERE session_id = ?', [session.session_id]);
                    } catch (e) { }
                    continue;
                }

                console.log(`[SessionManager] Reconnecting: ${session.name || session.session_id}`);

                // Fire and forget - each session handles its own connection/retry logic
                this.createSession(session.session_id, {
                    isNew: false,
                    onConnected: async (info) => {
                        console.log(`✅ [SessionManager] Session ${session.session_id} reconnected`);
                        await db.run('UPDATE whatsapp_sessions SET connected = 1, last_connected = ? WHERE session_id = ?',
                            [new Date().toISOString(), session.session_id]);
                    },
                    onDisconnected: async (reason) => {
                        console.log(`⚠️ [SessionManager] Session ${session.session_id} offline`);
                        await db.run('UPDATE whatsapp_sessions SET connected = 0 WHERE session_id = ?', [session.session_id]);
                        // Note: Connection retry logic is inside createSession
                    }
                }).catch(err => {
                    console.error(`[SessionManager] Error starting ${session.session_id}:`, err.message);
                });

                // Small delay to avoid hammering the system
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Start the health check monitor
            this.startHealthCheck();

        } catch (error) {
            console.error('[SessionManager] Error during restoreAllSessions:', error);
        }
    }
}

// Singleton instance
const sessionManager = new SessionManager();

module.exports = sessionManager;
