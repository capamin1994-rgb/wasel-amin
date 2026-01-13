#!/bin/bash
# Post-deployment setup script for cloud environments

set -e

echo "🚀 Post-deployment setup starting..."

# Set environment variables to suppress warnings
export NODE_NO_WARNINGS=1
export SUPPRESS_NO_CONFIG_WARNING=true
export NPM_CONFIG_FUND=false
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_LOGLEVEL=error

# Create necessary directories if they don't exist
mkdir -p /app/data
mkdir -p /app/logs  
mkdir -p /app/uploads
mkdir -p /app/src/auth_sessions
mkdir -p /app/public/receipts

# Set proper permissions
chmod 755 /app/data
chmod 755 /app/logs
chmod 755 /app/uploads
chmod 755 /app/src/auth_sessions
chmod 755 /app/public/receipts

# Check if SQLite database exists, if not create it
if [ ! -f "/app/data/app.db" ]; then
    echo "📁 Creating initial database..."
    touch /app/data/app.db
    chmod 644 /app/data/app.db
fi

# Verify Node.js version
echo "📋 Checking Node.js version..."
node --version

# Verify npm configuration
echo "📦 NPM configuration:"
npm config list | grep -E "(fund|audit|loglevel)"

echo "✅ Post-deployment setup complete!"
echo "🎉 Application ready to start"