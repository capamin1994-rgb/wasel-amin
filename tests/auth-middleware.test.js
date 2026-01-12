/**
 * Tests for JWT authentication middleware
 * Ensures the JWT secret is properly configured and tokens work correctly
 */

describe('Auth Middleware', () => {
    let originalEnv;

    beforeEach(() => {
        // Save original environment
        originalEnv = process.env.JWT_SECRET;
        // Clear module cache to test fresh imports
        jest.resetModules();
    });

    afterEach(() => {
        // Restore original environment
        if (originalEnv !== undefined) {
            process.env.JWT_SECRET = originalEnv;
        } else {
            delete process.env.JWT_SECRET;
        }
        jest.resetModules();
    });

    describe('JWT Secret Configuration', () => {
        test('should use JWT_SECRET from environment when set', () => {
            process.env.JWT_SECRET = 'test-secret-from-env';
            
            const { generateToken } = require('../src/middleware/auth');
            const jwt = require('jsonwebtoken');
            
            const testUser = { id: 'test-id', name: 'Test User', role: 'user' };
            const token = generateToken(testUser);
            
            // Verify token can be decoded with the env secret
            const decoded = jwt.verify(token, 'test-secret-from-env');
            expect(decoded.id).toBe('test-id');
            expect(decoded.name).toBe('Test User');
            expect(decoded.role).toBe('user');
        });

        test('should generate random secret when JWT_SECRET not set', () => {
            delete process.env.JWT_SECRET;
            
            // Suppress console warnings during test
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            
            const { generateToken } = require('../src/middleware/auth');
            
            const testUser = { id: 'test-id', name: 'Test User', role: 'user' };
            const token = generateToken(testUser);
            
            // Token should be generated (not throw)
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.split('.').length).toBe(3); // JWT has 3 parts
            
            // Warning should have been logged
            expect(warnSpy).toHaveBeenCalled();
            
            warnSpy.mockRestore();
        });

        test('should NOT use hardcoded secret', () => {
            delete process.env.JWT_SECRET;
            
            // Suppress console warnings during test
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            
            const { generateToken } = require('../src/middleware/auth');
            const jwt = require('jsonwebtoken');
            
            const testUser = { id: 'test-id', name: 'Test User', role: 'user' };
            const token = generateToken(testUser);
            
            // Token should NOT be verifiable with the old hardcoded secret
            expect(() => {
                jwt.verify(token, 'super_secret_key_123');
            }).toThrow();
            
            warnSpy.mockRestore();
        });
    });

    describe('Token Generation', () => {
        beforeEach(() => {
            process.env.JWT_SECRET = 'test-secret';
        });

        test('should generate valid JWT token', () => {
            const { generateToken } = require('../src/middleware/auth');
            const jwt = require('jsonwebtoken');
            
            const testUser = { id: 'user-123', name: 'John Doe', role: 'admin' };
            const token = generateToken(testUser);
            
            const decoded = jwt.verify(token, 'test-secret');
            expect(decoded.id).toBe('user-123');
            expect(decoded.name).toBe('John Doe');
            expect(decoded.role).toBe('admin');
        });

        test('should set token expiration to 24 hours', () => {
            const { generateToken } = require('../src/middleware/auth');
            const jwt = require('jsonwebtoken');
            
            const testUser = { id: 'user-123', name: 'Test', role: 'user' };
            const token = generateToken(testUser);
            
            const decoded = jwt.decode(token);
            const expiresIn = decoded.exp - decoded.iat;
            
            // 24 hours = 86400 seconds
            expect(expiresIn).toBe(86400);
        });
    });

    describe('Token Verification Middleware', () => {
        beforeEach(() => {
            process.env.JWT_SECRET = 'test-secret';
        });

        test('should reject requests without token', () => {
            const { authenticateToken } = require('../src/middleware/auth');
            
            const req = { 
                cookies: {},
                originalUrl: '/api/test'
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();
            
            authenticateToken(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should reject invalid tokens', () => {
            const { authenticateToken } = require('../src/middleware/auth');
            
            const req = { 
                cookies: { token: 'invalid-token' },
                originalUrl: '/api/test'
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();
            
            // Suppress console error during test
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            
            authenticateToken(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
            
            errorSpy.mockRestore();
        });

        test('should accept valid tokens and set req.user', () => {
            const { authenticateToken, generateToken } = require('../src/middleware/auth');
            
            const testUser = { id: 'user-123', name: 'Test', role: 'user' };
            const token = generateToken(testUser);
            
            const req = { 
                cookies: { token },
                originalUrl: '/api/test'
            };
            const res = {};
            const next = jest.fn();
            
            authenticateToken(req, res, next);
            
            expect(next).toHaveBeenCalled();
            expect(req.user).toBeDefined();
            expect(req.user.id).toBe('user-123');
            expect(req.user.name).toBe('Test');
            expect(req.user.role).toBe('user');
        });
    });
});
