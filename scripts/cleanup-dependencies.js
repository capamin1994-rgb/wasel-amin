#!/usr/bin/env node
/**
 * Cleanup script to remove deprecated packages and fix warnings
 * Run this script to clean up npm dependencies and resolve version conflicts
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧹 Starting dependency cleanup...\n');

// Function to run commands safely
function runCommand(command, description) {
    console.log(`📦 ${description}`);
    try {
        execSync(command, { stdio: 'inherit', cwd: process.cwd() });
        console.log('✅ Success\n');
    } catch (error) {
        console.warn(`⚠️ Warning: ${description} failed, continuing...\n`);
    }
}

// Clean npm cache
runCommand('npm cache clean --force', 'Cleaning npm cache');

// Remove node_modules and package-lock.json
console.log('🗂️ Removing node_modules and package-lock.json');
try {
    if (fs.existsSync('node_modules')) {
        fs.rmSync('node_modules', { recursive: true, force: true });
    }
    if (fs.existsSync('package-lock.json')) {
        fs.unlinkSync('package-lock.json');
    }
    console.log('✅ Cleanup complete\n');
} catch (error) {
    console.warn('⚠️ Warning: Cleanup failed, continuing...\n');
}

// Install dependencies with latest npm
runCommand('npm install -g npm@latest', 'Updating npm to latest version');

// Fresh install
runCommand('npm install --no-fund --no-audit', 'Installing dependencies (suppressing warnings)');

// Rebuild native modules
runCommand('npm rebuild', 'Rebuilding native modules');

// Run audit fix for security issues only
runCommand('npm audit fix --audit-level moderate', 'Fixing moderate security issues');

console.log('🎉 Dependency cleanup complete!');
console.log('📊 Final package status:');
runCommand('npm ls --depth=0', 'Showing installed packages');