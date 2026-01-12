const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Use environment variable for JWT secret, generate secure random if not set
// WARNING: If JWT_SECRET is not set, a random secret is generated on each server restart,
// which will invalidate all existing tokens. Always set JWT_SECRET in production.
const SECRET = process.env.JWT_SECRET || (() => {
    console.warn('⚠️  WARNING: JWT_SECRET environment variable not set. Using generated secret.');
    console.warn('⚠️  All tokens will be invalidated on server restart. Set JWT_SECRET in production!');
    return crypto.randomBytes(64).toString('hex');
})();

const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        // Check if this is an API request (use originalUrl to get full path)
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.redirect('/login');
    }

    jwt.verify(token, SECRET, (err, user) => {
        if (err) {
            console.error('JWT verification error:', err.message);
            // Check if this is an API request (use originalUrl to get full path)
            if (req.originalUrl.startsWith('/api/')) {
                return res.status(401).json({ error: 'Invalid token: ' + err.message });
            }
            return res.redirect('/login');
        }
        req.user = user;
        next();
    });
};

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).send('Forbidden');
    }
};

const generateToken = (user) => {
    return jwt.sign({ id: user.id, name: user.name, role: user.role }, SECRET, { expiresIn: '24h' });
};

module.exports = { authenticateToken, isAdmin, generateToken };
