const { DateTime } = require('luxon');
require('dotenv').config();

function checkApiKey(...allowedRoles) {
    return (req, res, next) => {
        const apiKey = req.headers.key;
        const token = req.headers.token;

        // 1. Require at least one credential header
        if (!apiKey && !token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 2. Server API Key validation
        if (apiKey) {
            if (apiKey === process.env.API_KEY) {
                req.authType = 'server';
                return next(); // Always allowed, bypasses role checks
            }
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 3. Client Token validation
        if (token) {
            // UNIMPLEMENTED: Replace this block with your token/crypto verification
            //
            // Example future implementation:
            // const client = await verifyClientToken(token);
            // if (!client) return res.status(401).json({ error: 'Unauthorized' });
            //
            // req.authType = 'client';
            // req.client = client;
            //
            // // Role Check:
            // // If allowedRoles is empty, allow all clients.
            // // Otherwise, verify the client has one of the allowed roles.
            // if (allowedRoles.length > 0 && !allowedRoles.includes(client.role)) {
            //     return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
            // }
            //
            // return next();

            return res.status(401).json({ error: 'Unauthorized' });
        }

        return res.status(401).json({ error: 'Unauthorized' });
    };
}

// Validate train route data|
function validateRoute(route) {
    for (const station of route) {
        const { name, code, type, track, arrival, departure, stopType, passed, cancelledAtStation } = station;
        if (!name || !code || !type || !track || !arrival || !departure || !stopType || passed === undefined || cancelledAtStation === undefined) {
            return 'Missing required fields in route';
        }
        if (typeof arrival.hours !== 'number' || typeof arrival.minutes !== 'number' ||
            typeof departure.hours !== 'number' || typeof departure.minutes !== 'number') {
            return 'Invalid time format';
        }
    }
    return true;
}

// Convert local time to UTC
function convertToUTC(route) {
    return route.map(station => {
        const { name, code, type, track, arrival, departure, stopType, passed, cancelledAtStation } = station;

        const arrivalUTC = DateTime.fromObject({ hour: arrival.hours, minute: arrival.minutes }, { zone: 'Europe/Oslo' }).toUTC().toJSDate();
        const departureUTC = DateTime.fromObject({ hour: departure.hours, minute: departure.minutes }, { zone: 'Europe/Oslo' }).toUTC().toJSDate();

        return { name, code, type, track, arrival: arrivalUTC, departure: departureUTC, stopType, passed, cancelledAtStation };
    });
}

module.exports = { checkApiKey, validateRoute, convertToUTC };
