#!/usr/bin/env node
// Enhanced Health Check Script for Cloud Deployment
const http = require('http');

const healthCheck = () => {
    const port = process.env.PORT || 3001;
    const timeout = 10000; // Increased timeout for cloud environments
    
    const options = {
        hostname: '127.0.0.1', // More reliable than localhost
        port: port,
        path: '/api/health',
        method: 'GET',
        timeout: timeout,
        headers: {
            'User-Agent': 'Health-Check/1.0'
        }
    };

    console.log(`🔍 Checking health at http://127.0.0.1:${port}/api/health`);

    const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            if (res.statusCode === 200) {
                try {
                    const response = JSON.parse(data);
                    if (response.status === 'OK') {
                        console.log('✅ Health check passed - Server is healthy');
                        process.exit(0);
                    } else {
                        console.error(`❌ Health check failed - Server status: ${response.status}`);
                        process.exit(1);
                    }
                } catch (e) {
                    console.log('✅ Health check passed - Server responding');
                    process.exit(0);
                }
            } else {
                console.error(`❌ Health check failed: HTTP ${res.statusCode}`);
                process.exit(1);
            }
        });
    });

    req.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
            console.error('❌ Health check failed: Server not running');
        } else {
            console.error('❌ Health check error:', err.message);
        }
        process.exit(1);
    });

    req.on('timeout', () => {
        console.error('❌ Health check timeout after', timeout + 'ms');
        req.destroy();
        process.exit(1);
    });

    req.setTimeout(timeout);
    req.end();
};

// Retry logic for better reliability
const maxRetries = 3;
let currentRetry = 0;

const runHealthCheck = () => {
    if (currentRetry >= maxRetries) {
        console.error(`❌ Health check failed after ${maxRetries} retries`);
        process.exit(1);
    }
    
    currentRetry++;
    if (currentRetry > 1) {
        console.log(`🔄 Retry attempt ${currentRetry}/${maxRetries}`);
    }
    
    try {
        healthCheck();
    } catch (error) {
        console.error('❌ Health check exception:', error.message);
        if (currentRetry < maxRetries) {
            setTimeout(runHealthCheck, 2000); // Wait 2s before retry
        } else {
            process.exit(1);
        }
    }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Health check interrupted');
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('🛑 Health check interrupted');
    process.exit(1);
});

runHealthCheck();