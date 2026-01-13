// Health Check Script for Cloud Deployment
const http = require('http');

const healthCheck = () => {
    const options = {
        hostname: 'localhost',
        port: process.env.PORT || 3001,
        path: '/api/health',
        method: 'GET',
        timeout: 5000
    };

    const req = http.request(options, (res) => {
        if (res.statusCode === 200) {
            console.log('✅ Health check passed');
            process.exit(0);
        } else {
            console.error(`❌ Health check failed: Status ${res.statusCode}`);
            process.exit(1);
        }
    });

    req.on('error', (err) => {
        console.error('❌ Health check error:', err.message);
        process.exit(1);
    });

    req.on('timeout', () => {
        console.error('❌ Health check timeout');
        req.destroy();
        process.exit(1);
    });

    req.end();
};

healthCheck();