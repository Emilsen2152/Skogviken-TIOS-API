const { DateTime } = require('luxon');
require('dotenv').config();

// API key validation
function checkApiKey(req, res, next) {
    // Check if the API key is present in the request headers
    if (!req.headers || !req.headers.key) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // Validate the API key
    const apiKey = req.headers.key;

    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

// Validate train route data
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
