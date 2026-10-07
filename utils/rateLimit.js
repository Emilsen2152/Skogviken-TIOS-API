const { rateLimit } = require('express-rate-limit');
const ApiToken = require('./apiToken');
const { hasMasterKey, hashToken } = require('./helpers');

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const ANON_LIMIT = Number(process.env.RATE_LIMIT_ANON) || 60;
const TOKEN_LIMIT = Number(process.env.RATE_LIMIT_TOKEN) || 200;

const baseOptions = {
    windowMs: WINDOW_MS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
};

// Anonymous (and invalid-token) requests are limited per IP
const anonLimiter = rateLimit({ ...baseOptions, limit: ANON_LIMIT });

// Valid bearer tokens are limited per token
const tokenLimiter = rateLimit({
    ...baseOptions,
    limit: TOKEN_LIMIT,
    keyGenerator: (req) => `token:${req.rateLimitTokenId}`
});

// Master key skips limiting entirely
async function rateLimiter(req, res, next) {
    try {
        if (hasMasterKey(req)) return next();

        const auth = req.headers.authorization;
        const match = auth && /^Bearer\s+(.+)$/i.exec(auth);
        if (match) {
            const token = await ApiToken.findOne({ tokenHash: hashToken(match[1].trim()) }).select('_id revoked expiresAt');
            if (token && !token.revoked && !(token.expiresAt && token.expiresAt < new Date())) {
                req.rateLimitTokenId = token._id.toString();
                return tokenLimiter(req, res, next);
            }
        }
        return anonLimiter(req, res, next);
    } catch (error) {
        next(error);
    }
}

module.exports = { rateLimiter };
