const { DateTime } = require('luxon');
require('dotenv').config();

// API key validation middleware
function checkApiKey(req, res, next) {
    if (!req.headers || !req.headers.key) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const apiKey = req.headers.key;
    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

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

module.exports = { checkApiKey, validateRoute, convertToUTC };