const { DateTime } = require('luxon');

// API key validation
function checkApiKey(req) {
    return req.headers.key === process.env.API_KEY;
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
