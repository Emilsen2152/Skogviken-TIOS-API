const { DateTime } = require('luxon');
require('dotenv').config();

const crypto = require('crypto');
const ApiToken = require('./apiToken');

function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function hasMasterKey(req) {
    const apiKey = req.headers && req.headers.key;
    return !!apiKey && !!process.env.API_KEY && safeEqual(apiKey, process.env.API_KEY);
}

// Permissions are "<resource>:<read|write>". Resource is the first path segment
// (for /fido/<x> it is "fido.<x>"). GET/HEAD = read, everything else = write.
// A granted permission matches with wildcards: "*", "*:read", "trains:*", "fido:write" (covers fido.gsmr).
function requiredPermission(req) {
    const segments = req.path.split('/').filter(Boolean);
    let resource = segments[0] || '';
    if (resource === 'fido' && segments[1]) resource += '.' + segments[1];
    const action = ['GET', 'HEAD'].includes(req.method) ? 'read' : 'write';
    return { resource, action };
}

function permissionGranted(granted, { resource, action }) {
    return granted.some((perm) => {
        if (perm === '*') return true;
        const [res, act] = perm.split(':');
        if (!res || !act) return false;
        const actionOk = act === '*' || act === action;
        const resourceOk = res === '*' || res === resource || resource.startsWith(res + '.');
        return actionOk && resourceOk;
    });
}

// Master key (header "key") = full access.
// Bearer token (Authorization: Bearer <token>) = access limited to its permissions.
async function checkApiKey(req, res, next) {
    try {
        if (hasMasterKey(req)) return next();

        const auth = req.headers && req.headers.authorization;
        const match = auth && /^Bearer\s+(.+)$/i.exec(auth);
        if (!match) return res.status(401).json({ error: 'Unauthorized' });

        const token = await ApiToken.findOne({ tokenHash: hashToken(match[1].trim()) });
        if (!token || token.revoked || (token.expiresAt && token.expiresAt < new Date())) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!permissionGranted(token.permissions, requiredPermission(req))) {
            return res.status(403).json({ error: 'Forbidden: token lacks required permission' });
        }

        token.lastUsedAt = new Date();
        token.save().catch(() => {});
        req.apiToken = token;
        next();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Only the master key may pass (used for managing bearer tokens)
function requireMasterKey(req, res, next) {
    if (!hasMasterKey(req)) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// Validate static train route timetable data
function validateRoute(route) {
    if (!Array.isArray(route) || route.length === 0) {
        return 'Route must be a non-empty array';
    }

    for (const station of route) {
        const { name, code, type, track, arrival, departure, stopType } = station;

        // Allow track value of 0 or "0"
        if (!name || !code || !type || track === undefined || track === null || track === '' ||
            !arrival || !departure || !stopType) {
            return 'Missing required fields in route';
        }

        // Validate time object structure and numeric range
        const isValidTime = (t) =>
            typeof t === 'object' && t !== null &&
            typeof t.hours === 'number' && t.hours >= 0 && t.hours <= 23 &&
            typeof t.minutes === 'number' && t.minutes >= 0 && t.minutes <= 59;

        if (!isValidTime(arrival) || !isValidTime(departure)) {
            return 'Invalid time format or range (hours: 0-23, minutes: 0-59)';
        }
    }
    return true;
}

// Convert local time objects to UTC Date objects for active route monitoring
function convertToUTC(route) {
    return route.map((station) => {
        const { name, code, type, track, arrival, departure, stopType } = station;

        const arrivalUTC = DateTime.fromObject(
            { hour: arrival.hours, minute: arrival.minutes },
            { zone: 'Europe/Oslo' }
        ).toUTC().toJSDate();

        const departureUTC = DateTime.fromObject(
            { hour: departure.hours, minute: departure.minutes },
            { zone: 'Europe/Oslo' }
        ).toUTC().toJSDate();

        return {
            name,
            code,
            type,
            track,
            arrival: arrivalUTC,
            departure: departureUTC,
            stopType,
            passed: station.passed ?? false,
            cancelledAtStation: station.cancelledAtStation ?? false
        };
    });
}

module.exports = { checkApiKey, requireMasterKey, hashToken, validateRoute, convertToUTC };