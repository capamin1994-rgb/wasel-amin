const express = require('express');
const router = express.Router();
const sessionManager = require('../services/baileys/SessionManager');
const messageService = require('../services/baileys/MessageService');
const { db } = require('../database/db');
const connectionStability = require('../middleware/connectionStability');
const AuthService = require('../services/auth');

// Helper to check session ownership
const checkSessionOwner = async (req, sessionId) => {
    if (req.user.role === 'admin') return true;

    // Check DB first
    const session = await db.get('SELECT user_id FROM whatsapp_sessions WHERE session_id = ?', [sessionId]);
    if (session && session.user_id == req.user.id) return true;

    // Fallback: Check ID format (unsafe but useful if DB record missing temporarily)
    if (sessionId.startsWith(`user_${req.user.id}_`)) return true;

    return false;
};

// Middleware to check authentication (allow both admin and regular users)
const requireAuth = (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({ error: 'Authentication error' });
    }
};

// Middleware to check admin role only
const requireAdmin = (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({ error: 'Authentication error' });
    }
};

// ==================== SESSION MANAGEMENT ====================

// Test endpoint
router.get('/test', async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Authentication working',
            user: { id: req.user.id, name: req.user.name, role: req.user.role }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all sessions (Admins get all by default or filtered, Users get theirs)
router.get('/list', requireAuth, async (req, res) => {
    try {
        let dbSessions;
        const targetUserId = req.query.userId;
        const showAll = req.query.all === 'true' && req.user.role === 'admin';

        if (req.user.role === 'admin') {
            if (showAll) {
                // Get ALL sessions across the platform
                dbSessions = await db.all(`
                    SELECT ws.*, u.name as user_name, u.phone as user_phone 
                    FROM whatsapp_sessions ws
                    LEFT JOIN users u ON ws.user_id = u.id
                    ORDER BY ws.created_at DESC
                `);
            } else if (targetUserId) {
                // Get sessions for a SPECIFIC user
                dbSessions = await db.all(`
                    SELECT ws.*, u.name as user_name, u.phone as user_phone 
                    FROM whatsapp_sessions ws
                    LEFT JOIN users u ON ws.user_id = u.id
                    WHERE ws.user_id = ?
                    ORDER BY ws.created_at DESC
                `, [targetUserId]);
            } else {
                // Default Admin View: ONLY Admin's own sessions
                dbSessions = await db.all(`
                    SELECT ws.*, u.name as user_name, u.phone as user_phone 
                    FROM whatsapp_sessions ws
                    LEFT JOIN users u ON ws.user_id = u.id
                    WHERE ws.user_id = ?
                    ORDER BY ws.created_at DESC
                `, [req.user.id]);
            }
        } else {
            // Regular User: Only their own
            dbSessions = await db.all(`
                SELECT ws.*, u.name as user_name, u.phone as user_phone 
                FROM whatsapp_sessions ws
                LEFT JOIN users u ON ws.user_id = u.id
                WHERE ws.user_id = ?
                ORDER BY ws.created_at DESC
            `, [req.user.id]);
        }

        // Get active sessions from SessionManager
        const activeSessions = sessionManager.getAllSessions();
        const activeMap = new Map(activeSessions.map(s => [s.sessionId, s]));

        // Merge data
        const sessions = dbSessions.map(session => {
            const active = activeMap.get(session.session_id);
            return {
                ...session,
                connected: active ? active.connected : false,
                phoneNumber: active ? active.phoneNumber : null,
                waName: active ? active.name : null
            };
        });

        res.json(sessions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get specific session status
router.get('/status/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!(await checkSessionOwner(req, sessionId))) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        const isConnected = sessionManager.isConnected(sessionId);
        const sessionInfo = sessionManager.getSessionInfo(sessionId);
        const qrCode = isConnected ? null : sessionManager.getQRCode(sessionId);
        const hasQR = !!qrCode;

        res.json({
            success: true,
            connected: isConnected,
            sessionInfo,
            hasQR,
            qrCode
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get QR code for session
router.get('/qr/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!(await checkSessionOwner(req, sessionId))) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        const qrCode = sessionManager.getQRCode(sessionId);

        if (!qrCode) {
            return res.status(404).json({ error: 'QR code not available' });
        }

        res.json({
            success: true,
            qrCode,
            sessionId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Initialize/Reconnect session
router.post('/connect', connectionStability, requireAuth, async (req, res) => {
    try {
        console.log('Connect request received:', req.body);

        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid request body' });
        }

        let { sessionId, userId, deviceType, sessionName, webhookUrl, phoneNumber } = req.body;

        // Force userId for non-admins
        if (req.user.role !== 'admin') {
            userId = req.user.id;
        }

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        // --- Check Session Limits (New Feature) ---
        try {
            // Get user's active subscription and plan limits
            const subscription = await db.get(`
                SELECT p.max_sessions 
                FROM subscriptions s 
                JOIN plans p ON s.plan_id = p.id 
                WHERE s.user_id = ? AND s.status = 'active'
                ORDER BY s.created_at DESC LIMIT 1
            `, [userId]);

            // Default to 1 (Trial) if no active sub found
            const maxSessions = subscription ? (subscription.max_sessions || 1) : 1;

            // Count existing sessions
            const sessionCount = await db.get('SELECT count(*) as count FROM whatsapp_sessions WHERE user_id = ?', [userId]);

            // Only block if creating a NEW session (sessionId not in DB)
            let isNewSession = true;
            if (req.body.sessionId) {
                const existing = await db.get('SELECT session_id FROM whatsapp_sessions WHERE session_id = ?', [req.body.sessionId]);
                if (existing) isNewSession = false;
            }

            if (isNewSession && sessionCount.count >= maxSessions) {
                return res.status(403).json({
                    success: false,
                    error: `عفواً، لقد وصلت للحد الأقصى من الجلسات المسموحة (${maxSessions}). رقي باقتك لإضافة المزيد.`
                });
            }
        } catch (limitErr) {
            console.error('Session limit check error:', limitErr);
            // Don't block on error, just log it? Or fail safe? Let's allow for now but log.
        }
        // ------------------------------------------

        // Generate new session ID if not provided
        if (!sessionId) {
            sessionId = `user_${userId}_${Date.now()}`;
            const normalizedPhoneNumber = phoneNumber ? AuthService.normalizePhone(phoneNumber) : null;

            try {
                await db.run(
                    'INSERT INTO whatsapp_sessions (session_id, user_id, device_type, name, webhook_url, phone_number) VALUES (?, ?, ?, ?, ?, ?)',
                    [sessionId, userId, deviceType || 'web', sessionName || 'Default Session', webhookUrl || null, normalizedPhoneNumber]
                );
            } catch (dbError) {
                console.error('Database error:', dbError);
                return res.status(500).json({ error: 'Database error: ' + dbError.message });
            }
        } else {
            // Verify ownership if sessionId provided
            if (!(await checkSessionOwner(req, sessionId))) {
                return res.status(403).json({ error: 'Unauthorized access to session' });
            }
        }

        // Check if already connected
        if (sessionManager.isConnected(sessionId)) {
            return res.json({
                success: true,
                message: 'Already connected',
                sessionId
            });
        }

        // Check for existing sessions for this user and cleanup
        const userSessions = await db.all('SELECT session_id FROM whatsapp_sessions WHERE user_id = ?', [userId]);

        // If user already has other sessions (and max_sessions is 1), we should probably block here too 
        // but the limit check above handles NEW sessions. For existing sessions, we just continue.

        // Enhanced session creation with security improvements
        try {
            await sessionManager.createSession(sessionId, {
                isNew: false,
                onQR: (qrDataURL, qrText) => {
                    console.log(`Secure QR Code generated for session ${sessionId}`);
                },
                onConnected: async (info) => {
                    console.log(`Session ${sessionId} securely connected`);
                    try {
                        const normalizedConnectedPhone = AuthService.normalizePhone(info.phoneNumber);

                        // Check if this phone number is used by ANOTHER user
                        const duplicateSession = await db.get(`
                            SELECT ws.session_id, ws.user_id, u.name as owner_name 
                            FROM whatsapp_sessions ws
                            JOIN users u ON ws.user_id = u.id
                            WHERE ws.phone_number = ? AND ws.user_id != ?
                        `, [normalizedConnectedPhone, userId]);

                        if (duplicateSession) {
                            console.warn(`🚨 Duplicate WhatsApp number detected! ${normalizedConnectedPhone} belongs to user ${duplicateSession.user_id}`);

                            // Send warning message and disconnect
                            try {
                                const warning = `❌ *تنبيه أمني*
هذا الرقم مرتبط بالفعل بحساب آخر على المنصة.
لا يمكن ربط نفس الرقم بأكثر من حساب.
تم فصل الجلسة تلقائياً.`;
                                await messageService.sendMessage(sessionId, info.phoneNumber, warning);
                            } catch (e) { }

                            await sessionManager.disconnectSession(sessionId);
                            await db.run('UPDATE whatsapp_sessions SET connected = 0 WHERE session_id = ?', [sessionId]);
                            return;
                        }

                        await db.run('UPDATE whatsapp_sessions SET connected = 1, phone_number = ? WHERE session_id = ?', [normalizedConnectedPhone, sessionId]);

                        // --- ACCOUNT LINKING (User Request) ---
                        // Update the user's main account phone number to match this verified session
                        try {
                            const distinctUser = await db.get('SELECT id FROM users WHERE phone = ? AND id != ?', [normalizedConnectedPhone, userId]);
                            if (!distinctUser) {
                                await db.run('UPDATE users SET phone = ?, phone_verified_at = datetime("now") WHERE id = ?', [normalizedConnectedPhone, userId]);
                                console.log(`[Account Link] User ${userId} linked to verified phone ${normalizedConnectedPhone}`);
                            } else {
                                console.warn(`[Account Link] Phone ${normalizedConnectedPhone} is already used by user ${distinctUser.id}`);
                            }
                        } catch (linkErr) {
                            console.error('[Account Link] Error updating user phone:', linkErr);
                        }
                        // --------------------------------------

                        // Send welcome message if phone number is provided
                        if (info.phoneNumber) {
                            setTimeout(async () => {
                                try {
                                    if (!sessionManager.isConnected(sessionId)) return;

                                    const welcomeMessage = `🎉 مرحباً بك في منصة واصل!

✅ تم ربط جلسة "${sessionName || 'الجلسة الجديدة'}" بنجاح
📱 رقم الهاتف المرتبط: ${info.phoneNumber}
⏰ وقت الاتصال: ${new Date().toLocaleString('ar-EG')}

🔥 الآن يمكنك استخدام جميع مميزات المنصة!

💬 هذه رسالة تلقائية للتأكيد`;

                                    await messageService.sendMessage(sessionId, info.phoneNumber, welcomeMessage);
                                } catch (msgError) {
                                    console.error(`❌ Failed to send welcome message to ${info.phoneNumber}:`, msgError.message);
                                }
                            }, 5000);
                        }
                    } catch (dbError) {
                        console.error('DB update error:', dbError);
                    }
                },
                onDisconnected: async (reason) => {
                    console.log(`Session ${sessionId} disconnected`);
                    try {
                        await db.run('UPDATE whatsapp_sessions SET connected = 0 WHERE session_id = ?', [sessionId]);
                    } catch (dbError) {
                        console.error('DB update error:', dbError);
                    }
                }
            });
        } catch (sessionError) {
            console.error('SessionManager error:', sessionError);
            return res.status(500).json({ error: 'Session creation failed: ' + sessionError.message });
        }

        res.json({
            success: true,
            sessionId,
            message: 'Session initialization started'
        });

    } catch (error) {
        console.error('Connect route error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Request pairing code
router.post('/:sessionId/pairing-code', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { phoneNumber } = req.body;

        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        if (!(await checkSessionOwner(req, sessionId))) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        const code = await sessionManager.requestPairingCode(sessionId, phoneNumber);
        res.json({ success: true, code });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Disconnect/Delete session
router.delete('/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!(await checkSessionOwner(req, sessionId))) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        // Remove from Baileys
        await sessionManager.removeSession(sessionId);

        // Remove from DB
        await db.run('DELETE FROM whatsapp_sessions WHERE session_id = ?', [sessionId]);

        res.json({
            success: true,
            message: 'Session removed successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Disconnect only (keep in DB)
router.post('/:sessionId/disconnect', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!(await checkSessionOwner(req, sessionId))) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        await sessionManager.disconnectSession(sessionId);
        await db.run('UPDATE whatsapp_sessions SET connected = 0 WHERE session_id = ?', [sessionId]);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update session details (Name, Phone)
router.put('/:sessionId', requireAuth, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { name, phoneNumber } = req.body;

        if (!(await checkSessionOwner(req, sessionId))) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        const updates = [];
        const values = [];

        if (name) {
            updates.push('name = ?');
            values.push(name);
        }

        if (phoneNumber) {
            updates.push('phone_number = ?');
            values.push(phoneNumber);
        }

        if (updates.length === 0) {
            return res.json({ success: true, message: 'No changes made' });
        }

        values.push(sessionId);
        await db.run(`UPDATE whatsapp_sessions SET ${updates.join(', ')} WHERE session_id = ?`, values);

        res.json({ success: true, message: 'Session updated successfully' });
    } catch (error) {
        console.error('Update session error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== MESSAGE SENDING ====================

// Send test message
router.post('/send', async (req, res) => {
    try {
        const { sessionId, phoneNumber, message } = req.body;

        if (!sessionId || !phoneNumber || !message) {
            return res.status(400).json({ error: 'Missing required fields: sessionId, phoneNumber, or message' });
        }

        if (!(await checkSessionOwner(req, sessionId))) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        if (!sessionManager.isConnected(sessionId)) {
            return res.status(400).json({ error: `Session ${sessionId} is not connected` });
        }

        const result = await messageService.sendMessage(sessionId, phoneNumber, message);

        res.json({
            success: true,
            message: 'Message sent successfully',
            result
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get groups for a session
router.get('/groups/:sessionId', requireAuth, async (req, res) => {
    try {
        const { sessionId } = req.params;

        // Check ownership
        const isOwner = await checkSessionOwner(req, sessionId);
        if (!isOwner) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        const groups = await messageService.getGroups(sessionId);
        res.json(groups);

    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(400).json({ error: error.message || 'Failed to fetch groups' });
    }
});

// ==================== PHONE VERIFICATION ====================

// Send verification code via WhatsApp
router.post('/send-verification', requireAuth, async (req, res) => {
    try {
        const { sessionId, phoneNumber } = req.body;

        if (!sessionId || !phoneNumber) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check ownership
        const isOwner = await checkSessionOwner(req, sessionId);
        if (!isOwner) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        // Check that session exists but is NOT yet connected (pairing codes work before connection)
        const session = sessionManager.getSession(sessionId);
        if (!session) {
            return res.status(400).json({ error: 'Session not initialized. Please refresh and try again.' });
        }

        if (sessionManager.isConnected(sessionId)) {
            return res.status(400).json({ error: 'Session already connected. Use QR code scanning for already-connected sessions.' });
        }

        // Normalize phone number - remove all non-digits
        let normalizedPhone = phoneNumber.replace(/\D/g, '');

        console.log(`[Pairing] Original phone: ${phoneNumber}, Cleaned: ${normalizedPhone}`);

        // Handle Egyptian numbers starting with 0020 or 20
        if (normalizedPhone.startsWith('0020')) {
            normalizedPhone = normalizedPhone.substring(2);
        }

        // Fix double zeros in local format: 20010... -> 2010...
        if (normalizedPhone.startsWith('200')) {
            normalizedPhone = '20' + normalizedPhone.substring(3);
        }

        // Auto-detect and normalize Egyptian numbers
        if (normalizedPhone.startsWith('0') && normalizedPhone.length === 11) {
            // Format: 01066284516 → 201066284516
            normalizedPhone = '20' + normalizedPhone.substring(1);
            console.log(`[Pairing] Normalized from local format: ${normalizedPhone}`);
        } else if (normalizedPhone.length === 10 && /^(10|11|12|15)/.test(normalizedPhone)) {
            // Format: 1066284516 → 201066284516
            normalizedPhone = '20' + normalizedPhone;
            console.log(`[Pairing] Normalized from short format: ${normalizedPhone}`);
        } else if (normalizedPhone.startsWith('20') && normalizedPhone.length === 12) {
            // Correct international format
            console.log(`[Pairing] Phone is in correct international format: ${normalizedPhone}`);
        }

        console.log(`[Pairing] Final normalized phone for ${sessionId}: ${normalizedPhone}`);

        // Request pairing code from Baileys
        const code = await sessionManager.requestPairingCode(sessionId, normalizedPhone);

        if (!code) {
            return res.status(400).json({ error: 'Failed to generate pairing code' });
        }

        console.log(`[Pairing] Generated pairing code for ${sessionId}: ${code}`);
        console.log(`[Pairing] 📱 Notification should be sent to WhatsApp for phone: ${normalizedPhone}`);
        console.log(`[Pairing] 💡 User should see a notification on their WhatsApp asking to link the device`);

        res.json({
            success: true,
            code: code,
            message: 'تم توليد كود الربط. يجب أن يصل إشعار على الواتساب على الرقم المدخل. أدخل الكود في تطبيق واتساب.',
            notificationSent: true
        });

    } catch (error) {
        console.error('Error requesting pairing code:', error);
        res.status(500).json({ error: error.message });
    }
});

// Verify code and link phone to session
router.post('/verify-phone', requireAuth, async (req, res) => {
    try {
        const { sessionId, phoneNumber, code } = req.body;

        if (!sessionId || !phoneNumber || !code) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check ownership
        const isOwner = await checkSessionOwner(req, sessionId);
        if (!isOwner) {
            return res.status(403).json({ error: 'Unauthorized access to session' });
        }

        // Verify code format
        if (!/^\d{6}$/.test(code)) {
            return res.status(400).json({ error: 'Invalid code format' });
        }

        // Verify code in database
        const codeHash = require('crypto').createHash('md5').update(code).digest('hex');
        const verification = await db.get(
            'SELECT * FROM verification_codes WHERE session_id = ? AND code_hash = ? AND expires_at > datetime("now") ORDER BY created_at DESC LIMIT 1',
            [sessionId, codeHash]
        ).catch(() => null);

        if (!verification) {
            return res.status(400).json({ error: 'Invalid or expired code' });
        }

        // Normalize phone number
        let normalizedPhone = phoneNumber.replace(/\D/g, '');
        if (normalizedPhone.startsWith('0') && normalizedPhone.length === 11) {
            normalizedPhone = '20' + normalizedPhone.substring(1);
        } else if (normalizedPhone.length === 10 && /^(10|11|12|15)/.test(normalizedPhone)) {
            normalizedPhone = '20' + normalizedPhone;
        }

        // Update session with verified phone number
        await db.run(
            'UPDATE whatsapp_sessions SET verified_phone = ?, phone_verified_at = datetime("now") WHERE session_id = ?',
            [normalizedPhone, sessionId]
        );

        // Mark code as used
        await db.run(
            'UPDATE verification_codes SET verified = 1 WHERE id = ?',
            [verification.id]
        ).catch(() => { });

        // Send confirmation message
        const confirmMessage = `✅ تم ربط الرقم بنجاح!\n\nيمكنك الآن استخدام جميع مميزات المنصة`;
        await messageService.sendMessage(sessionId, phoneNumber, confirmMessage).catch(() => { });

        res.json({
            success: true,
            message: 'Phone verified successfully',
            phone: normalizedPhone
        });

    } catch (error) {
        console.error('Error verifying phone:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
