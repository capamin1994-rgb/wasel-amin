// تحسينات الخادم لزيادة سرعة الاستجابة
const compression = require('compression');
const cluster = require('cluster');
const os = require('os');

// Suppress warnings for production
if (process.env.NODE_ENV === 'production') {
    // Suppress specific warnings
    const originalEmit = process.emit;
    process.emit = function (name, data, ...args) {
        if (name === 'warning' && data.name === 'DeprecationWarning') {
            return false;
        }
        if (name === 'warning' && data.message && data.message.includes('deprecated')) {
            return false;
        }
        return originalEmit.apply(process, arguments);
    };
}

class ServerOptimizer {
    static applyOptimizations(app) {
        // ضغط الاستجابات
        app.use(compression({
            level: 6,
            threshold: 1024,
            filter: (req, res) => {
                if (req.headers['x-no-compression']) {
                    return false;
                }
                return compression.filter(req, res);
            }
        }));

        // تحسين إعدادات Express
        app.set('trust proxy', 1);
        app.set('x-powered-by', false);

        // JSON parsing is already handled by express.json() middleware in server.js
        // Removing duplicate/unsafe middleware that was causing undefined JSON errors

        // إضافة headers للتحسين والأمان
        app.use((req, res, next) => {
            const isDev = req.hostname === 'localhost' || req.hostname === '127.0.0.1';

            // تعزيز سياسة أمن المحتوى (CSP)
            // في وضع التطوير نسمح باتصالات أوسع لتجنب مشاكل DevTools و WebSockets
            const cspHeader = isDev
                ? "default-src 'self' http: https: data: blob: ws: wss:; script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:; style-src 'self' 'unsafe-inline' http: https:; img-src 'self' data: blob: http: https:; connect-src * 'self' http: https: ws: wss:; font-src 'self' http: https: data:; object-src 'none'; frame-src 'self' http: https:;"
                : "default-src 'self' https: data: blob: ws: wss:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; connect-src 'self' https: ws: wss:; font-src 'self' https: data:; object-src 'none'; frame-src 'self' https:;";

            res.setHeader('Content-Security-Policy', cspHeader);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-XSS-Protection', '1; mode=block');

            next();
        });

        console.log('✅ Server optimizations applied');
    }

    static enableClustering() {
        const numCPUs = os.cpus().length;

        if (cluster.isMaster && numCPUs > 1) {
            console.log(`Master ${process.pid} is running`);
            console.log(`Starting ${Math.min(numCPUs, 4)} workers...`);

            // Fork workers
            for (let i = 0; i < Math.min(numCPUs, 4); i++) {
                cluster.fork();
            }

            cluster.on('exit', (worker, code, signal) => {
                console.log(`Worker ${worker.process.pid} died`);
                console.log('Starting a new worker...');
                cluster.fork();
            });

            return false; // Don't start server in master process
        }

        return true; // Start server in worker process
    }

    static optimizeNodeJS() {
        // تحسين إعدادات Node.js
        process.env.UV_THREADPOOL_SIZE = Math.max(4, os.cpus().length);

        // تحسين Garbage Collection للبيئة السحابية
        if (process.env.NODE_ENV === 'production') {
            const maxMemory = process.env.MAX_OLD_SPACE_SIZE || '512';
            console.log(`💾 Memory limit configured to ${maxMemory}MB via deployment settings`);
        }

        // معالجة الأخطاء غير المتوقعة
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });

        console.log('✅ Node.js optimizations applied');
    }
}

module.exports = ServerOptimizer;