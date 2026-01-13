// Suppress Node.js warnings and deprecation notices
process.env.NODE_NO_WARNINGS = '1';
process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const ServerOptimizer = require('./src/services/ServerOptimizer');

// Apply Node.js optimizations
ServerOptimizer.optimizeNodeJS();

// Prevent crashes from unhandled rejections (common with Baileys/Libsignal)
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Do not exit the process, just log it
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Do not exit the process, just log it
});


const app = express();
app.isInitialized = false;
const PORT = process.env.PORT || 3001; // تغيير الافتراضي ليتوافق مع Render و Dockerfile

// Apply helmet early with standard security (CSP handled by ServerOptimizer)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
}));

// Apply server optimizations
ServerOptimizer.applyOptimizations(app);

// Database & Services
const { init: initDB, db } = require('./src/database/db');
const SettingsService = require('./src/services/settings');
const PlanService = require('./src/services/plans');
const AuthService = require('./src/services/auth');
const SessionManager = require('./src/services/baileys/SessionManager');
const { authenticateToken, generateToken } = require('./src/middleware/auth');
const adminRoutes = require('./src/routes/admin');

// Initialize with enhanced error handling
app.init = async () => {
    try {
        await initDB();
        await SettingsService.initDefaults();

        // Initialize Scheduler Service (Islamic Reminders)
        const SchedulerService = require('./src/services/SchedulerService');
        SchedulerService.init();

        // Seed Content Library
        const ContentService = require('./src/services/ContentService');
        await ContentService.seedInitialContent();

        // Initialize Hadith Service (API Cache)
        const HadithService = require('./src/services/HadithService');
        await HadithService.init();

        // Ensure Admin exists on every startup (Cloud Fix)
        const bcrypt = require('bcrypt');
        const adminEmail = 'aman01125062943@gmail.com';
        const adminPassword = '1994';
        const adminHash = await bcrypt.hash(adminPassword, 10);
        
        const existingAdmin = await db.get("SELECT id FROM users WHERE email = ?", [adminEmail]);
        if (existingAdmin) {
            await db.run("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?", [adminHash, existingAdmin.id]);
            console.log(`✅ Admin updated: ${adminEmail}`);
        } else {
            const adminId = require('crypto').randomUUID();
            await db.run("INSERT INTO users (id, name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, 'admin')",
                [adminId, 'Admin', adminEmail, '01125062943', adminHash]);
            console.log(`✅ Admin created: ${adminEmail}`);
        }

        // Auto-restore WhatsApp sessions on startup
        setTimeout(async () => {
            console.log('🚀 [Server] Starting automatic session restoration...');
            await SessionManager.restoreAllSessions();
        }, 10000); // Wait 10 seconds after server start to ensure all services are ready

        console.log('Server initialization completed');
        app.isInitialized = true;
    } catch (e) {
        console.error('Failed to initialize:', e);
        app.initializationError = e;
        // Do not exit, allow server to report error
    }
};

// Add JSON parsing error handler
app.use(express.json({
    limit: '10mb',
    verify: (req, res, buf, encoding) => {
        try {
            if (buf && buf.length) {
                JSON.parse(buf);
            }
        } catch (error) {
            console.error('JSON Parse Error:', error.message);
            console.error('Raw body:', buf.toString());
            throw new Error('Invalid JSON format');
        }
    }
}));

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

// Favicon route
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.png'));
});

// Admin API Routes
app.use('/api/admin', authenticateToken, adminRoutes);

// Health check endpoint for cloud monitoring
app.get('/api/health', (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        initialized: app.isInitialized || false
    };
    
    if (app.initializationError) {
        health.status = 'ERROR';
        health.error = app.initializationError.message;
        return res.status(500).json(health);
    }
    
    res.json(health);
});

// Readiness probe for Kubernetes/Cloud platforms
app.get('/api/ready', (req, res) => {
    if (app.isInitialized) {
        res.json({ status: 'READY', timestamp: new Date().toISOString() });
    } else {
        res.status(503).json({ status: 'NOT_READY', timestamp: new Date().toISOString() });
    }
});

// Enhanced WhatsApp API Routes with security
const whatsappRoutes = require('./src/routes/whatsapp');
app.use('/api', (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[API-LOG] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} (${duration}ms)`);
    });
    next();
});
app.use('/api/whatsapp', authenticateToken, whatsappRoutes);

// Islamic Reminders Routes (accessible to all authenticated users)
const islamicRemindersRoutes = require('./src/routes/islamic-reminders');
app.use('/dashboard', authenticateToken, islamicRemindersRoutes);
app.use('/api/islamic-reminders', authenticateToken, islamicRemindersRoutes);

// Hadith API Routes
app.use('/api/hadith', authenticateToken, require('./src/routes/hadith'));
app.use('/api/adhkar', authenticateToken, require('./src/routes/adhkar'));

// Payment Routes (Public for validation)
app.use('/payment', require('./src/routes/payment'));

// Routes
app.use('/', require('./src/routes/auth'));

// Redirect legacy /dashboard/whatsapp to hash-based route
app.get('/dashboard/whatsapp', authenticateToken, (req, res) => {
    res.redirect('/dashboard#whatsapp');
});

app.get('/', async (req, res) => {
    if (app.initializationError) {
        return res.status(500).send(`
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <meta charset="UTF-8">
                <title>خطأ في تشغيل المنصة</title>
                <style>
                    body { font-family: sans-serif; padding: 2rem; direction: rtl; text-align: right; background: #fff5f5; color: #c53030; }
                    .error-box { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border-right: 4px solid #c53030; }
                    pre { background: #f7fafc; padding: 1rem; border-radius: 4px; overflow-x: auto; direction: ltr; text-align: left; color: #2d3748; }
                </style>
            </head>
            <body>
                <div class="error-box">
                    <h1>حدث خطأ أثناء تشغيل المنصة</h1>
                    <p>يرجى مراجعة سجلات الخادم أو الاتصال بالدعم الفني.</p>
                    <hr>
                    <h3>تفاصيل الخطأ:</h3>
                    <pre>${app.initializationError.stack || app.initializationError.message}</pre>
                </div>
            </body>
            </html>
        `);
    }

    if (!app.isInitialized) {
        return res.status(200).send(`
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <meta charset="UTF-8">
                <title>جاري تشغيل المنصة...</title>
                <style>
                    body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0f2f5; color: #1c1e21; text-align: center; }
                    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
                    .spinner { border: 4px solid rgba(0,0,0,0.1); width: 36px; height: 36px; border-radius: 50%; border-left-color: #007bff; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
                <meta http-equiv="refresh" content="5">
            </head>
            <body>
                <div class="card">
                    <div class="spinner"></div>
                    <h1>جاري تشغيل المنصة...</h1>
                    <p>الموقع سيكون متاحاً خلال لحظات، يرجى الانتظار.</p>
                </div>
            </body>
            </html>
        `);
    }
    try {
        const settings = await SettingsService.get('landing_page');
        const plans = await PlanService.getAll();

        res.render('landing', {
            title: settings.hero.title || 'منصة واتساب',
            hero: settings.hero,
            features: settings.features,
            pricing: settings.pricing,
            plans: plans,
            settings: settings
        });
    } catch (e) {
        res.status(500).send('Error loading page: ' + e.message);
    }
});

// Middleware to fetch fresh user data from DB for dashboard pages
const fetchFreshUser = async (req, res, next) => {
    if (req.user && req.user.id) {
        try {
            const freshUser = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
            if (freshUser) {
                // Keep password_hash out of the req.user for security
                delete freshUser.password_hash;
                req.user = { ...req.user, ...freshUser };
            }
        } catch (err) {
            console.error('Error fetching fresh user:', err);
        }
    }
    next();
};

app.use('/dashboard', authenticateToken, fetchFreshUser);

// Middleware to prevent caching of sensitive pages
const nocache = (req, res, next) => {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    next();
};

app.get('/dashboard', nocache, async (req, res) => {
    // Fetch Subscription Details for User
    const sub = await db.get(`
        SELECT s.*, p.name as plan_name, p.is_trial, p.features, p.max_sessions 
        FROM subscriptions s
        JOIN plans p ON s.plan_id = p.id
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC LIMIT 1
    `, [req.user.id]);

    // Strict Access Control:
    // If user is NOT admin and does NOT have an active subscription (pending, expired, or none),
    // redirect them to the login page as requested.
    if (req.user.role !== 'admin' && (!sub || sub.status !== 'active')) {
        return res.redirect('/login');
    }

    // Parse User Features
    let userFeatures = {
        prayer_times: true,
        adhkar: true,
        morning_evening: true,
        before_after_prayer: true,
        quran: true,
        hadith: true,
        fasting: true,
        rosary: true,
        support: true
    };

    if (req.user.role !== 'admin' && sub && sub.features) {
        try {
            const features = JSON.parse(sub.features);
            userFeatures = {
                prayer_times: !!features.prayer_times,
                adhkar: !!features.adhkar,
                morning_evening: !!(features.morning_evening || features.adhkar),
                before_after_prayer: !!(features.before_after_prayer || features.adhkar),
                quran: !!(features.quran || features.adhkar),
                hadith: !!(features.hadith || features.adhkar),
                fasting: !!features.fasting,
                rosary: !!features.rosary,
                support: !!features.support
            };
        } catch (e) {
            console.error('Error parsing sub features:', e);
            userFeatures = {
                prayer_times: false,
                adhkar: false,
                morning_evening: false,
                before_after_prayer: false,
                quran: false,
                hadith: false,
                fasting: false,
                rosary: false,
                support: false
            };
        }
    }

    if (req.user.role === 'admin') {
        return res.render('dashboard/admin', {
            user: req.user,
            userFeatures,
            maxSessions: sub ? (sub.max_sessions || 999) : 999
        });
    }

    let percentRemaining = 0;
    let daysRemaining = 0;
    if (sub && sub.status === 'active') {
        const start = new Date(sub.start_date);
        const end = new Date(sub.end_date);
        const now = new Date();
        const total = end - start;
        const elapsed = now - start;
        percentRemaining = Math.max(0, Math.min(100, ((total - elapsed) / total) * 100));
        daysRemaining = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    }

    res.render('dashboard/user', {
        user: req.user,
        subscription: sub ? { ...sub, percentRemaining, daysRemaining } : null,
        userFeatures,
        maxSessions: sub ? (sub.max_sessions || 1) : 1
    });
});


// Admin Settings Routes
app.get('/dashboard/settings', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.redirect('/dashboard');

        const settings = await SettingsService.get('landing_page');
        res.render('dashboard/settings', { user: req.user, settings });
    } catch (error) {
        console.error('Error loading settings page:', error);
        res.status(500).send('خطأ في تحميل صفحة الإعدادات');
    }
});

// Islamic Reminders Dashboard Route
app.get('/dashboard/islamic-reminders', authenticateToken, async (req, res) => {
    try {
        // Get user's Islamic reminders configuration
        const config = await db.get(`
            SELECT * FROM islamic_reminders_config 
            WHERE user_id = ?
        `, [req.user.id]);

        // Get adhkar settings
        const adhkarSettings = config ? await db.get(`
            SELECT * FROM adhkar_settings 
            WHERE config_id = ?
        `, [config.id]) : null;

        // Get prayer reminders
        const prayerReminders = config ? await db.all(`
            SELECT * FROM prayer_reminders 
            WHERE config_id = ?
            ORDER BY prayer_name
        `, [config.id]) : [];

        // Get fasting settings
        const fastingSettings = config ? await db.get(`
            SELECT * FROM fasting_settings 
            WHERE config_id = ?
        `, [config.id]) : null;

        res.render('dashboard/islamic-reminders', { 
            user: req.user,
            config: config || {},
            adhkarSettings: adhkarSettings || {},
            prayerReminders: prayerReminders || [],
            fastingSettings: fastingSettings || {}
        });
    } catch (error) {
        console.error('Error loading Islamic Reminders dashboard:', error);
        res.status(500).send('خطأ في تحميل صفحة التذكيرات الإسلامية');
    }
});

app.post('/dashboard/settings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send('Unauthorized');

    try {
        // Construct the settings object directly from the form body
        // In a real app, we would validate this schema strictly.
        const newSettings = {
            brand: { name: req.body.brand_name || 'واصل' },
            hero: {
                title: req.body.hero_title,
                subtitle: req.body.hero_subtitle,
                show: req.body.hero_show === 'on'
            },
            features: {
                title: req.body.features_title,
                show: req.body.features_show === 'on',
                items: [] // We will parse these from the dynamic list if possible, or simplified for now
            },
            pricing: {
                title: req.body.pricing_title,
                show: req.body.pricing_show === 'on'
            },
            payment: {
                vodafone_cash: {
                    enabled: req.body.payment_vodafone_enabled === 'on',
                    number: req.body.payment_vodafone_number,
                    instructions: req.body.payment_vodafone_instructions
                },
                instapay: {
                    enabled: req.body.payment_instapay_enabled === 'on',
                    address: req.body.payment_instapay_address,
                    phone: req.body.payment_instapay_phone,
                    instructions: req.body.payment_instapay_instructions
                }
            },
            contact: {
                whatsapp: req.body.contact_whatsapp,
                email: req.body.contact_email
            }
        };

        // Handle dynamic feature items
        if (req.body['features_items_title[]'] && req.body['features_items_desc[]']) {
            const titles = Array.isArray(req.body['features_items_title[]'])
                ? req.body['features_items_title[]']
                : [req.body['features_items_title[]']];

            const descs = Array.isArray(req.body['features_items_desc[]'])
                ? req.body['features_items_desc[]']
                : [req.body['features_items_desc[]']];

            newSettings.features.items = titles.map((title, index) => ({
                title: title,
                desc: descs[index] || ''
            }));
        } else {
            // Fallback: Preserve or use default if empty submission logic
            const oldSettings = await SettingsService.get('landing_page');
            newSettings.features.items = oldSettings.features.items;
        }

        await SettingsService.set('landing_page', newSettings);
        res.json({ success: true, message: 'Settings saved successfully' });
    } catch (e) {
        console.error('Settings Save Error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Health check endpoint for Docker
app.get('/health', (req, res) => {
    res.status(200).json({
        status: app.isInitialized ? 'ok' : 'initializing',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Global error handler for API routes
app.use('/api', (error, req, res, next) => {
    console.error('API Error:', error);
    if (res.headersSent) {
        return next(error);
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
});

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
        console.log('📦 Starting background initialization...');

        app.init()
            .then(() => {
                app.isInitialized = true;
                console.log('✅ Server initialization completed successfully');
            })
            .catch(err => {
                console.error('❌ Critical initialization error:', err);
                // In production, we might want to alert of failure but keep server up to show status/logs
            });
    });
}

module.exports = app;
