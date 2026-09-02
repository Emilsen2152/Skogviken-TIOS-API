const { DateTime } = require('luxon');
const trains = require('./train.js');

// ============================================================
// Journey search configuration
// ============================================================

const JOURNEY_CONFIG = {
    MAX_LEGS: 3,
    MAX_RESULTS: 5,

    // Minimum time required to transfer between trains.
    MIN_TRANSFER_MINUTES: 1,

    // How long the timetable index is kept in memory.
    // Keep this fairly short because train data can change.
    CACHE_TTL_MS: 60_000,

    // Prevent an unusually large search from consuming the server.
    MAX_SEARCH_STATES: 25_000
};

// ============================================================
// Journey timetable cache
// ============================================================

let journeyCache = {
    expiresAt: 0,
    servicesByStation: new Map()
};

let journeyCachePromise = null;


// ============================================================
// Date parsing
// ============================================================

function parseJourneyDateTime(value) {
    if (!value || typeof value !== 'string') {
        return null;
    }

    const formats = [
        'yyyy-MM-dd HH:mm:ss',
        'yyyy-MM-dd HH:mm',
        'dd.MM.yyyy HH:mm:ss',
        'dd.MM.yyyy HH:mm'
    ];

    // ISO with timezone/offset
    let date = DateTime.fromISO(value, {
        setZone: true
    });

    if (date.isValid) {
        return date.toJSDate();
    }

    // ISO/local values without an offset should be interpreted
    // as Norwegian local time instead of the server's timezone.
    date = DateTime.fromISO(value, {
        zone: 'Europe/Oslo'
    });

    if (date.isValid) {
        return date.toJSDate();
    }

    for (const format of formats) {
        date = DateTime.fromFormat(value, format, {
            zone: 'Europe/Oslo'
        });

        if (date.isValid) {
            return date.toJSDate();
        }
    }

    return null;
}


function formatJourneyTime(date) {
    return DateTime
        .fromJSDate(date, { zone: 'Europe/Oslo' })
        .toFormat('dd.MM.yyyy HH:mm');
}


// ============================================================
// Helpers
// ============================================================

function getStopTime(stop, type) {
    const value = stop?.[type];

    if (!value) {
        return null;
    }

    const date = value instanceof Date
        ? value
        : new Date(value);

    return Number.isNaN(date.getTime())
        ? null
        : date;
}


function isPassengerStop(stop) {
    return (
        stop &&
        (!stop.stopType || stop.stopType === 'Passenger') &&
        !stop.cancelledAtStation
    );
}


function createJourneyService(train, stops) {
    return {
        trainNumber: train.trainNumber,
        operator: train.operator,
        routeNumber: train.routeNumber || '',

        // Keep the complete usable route for this train.
        stops
    };
}


// ============================================================
// Build timetable index
// ============================================================
//
// Instead of generating:
//
//     every station -> every later station
//
// for every train, we index trains by their BOARDING station:
//
//     servicesByStation.get("VOSS")
//         -> trains that can be boarded at VOSS
//
// The actual destination of each leg is determined only when
// the journey search needs it.
// ============================================================

async function buildJourneyIndex() {
    const allTrains = await trains
        .find(
            {},
            {
                trainNumber: 1,
                operator: 1,
                routeNumber: 1,
                currentRoute: 1
            }
        )
        .lean()
        .exec();

    const servicesByStation = new Map();

    for (const train of allTrains) {
        if (!train.currentRoute?.length) {
            continue;
        }

        const stops = [];

        for (let index = 0; index < train.currentRoute.length; index++) {
            const stop = train.currentRoute[index];

            if (!isPassengerStop(stop)) {
                continue;
            }

            const arrival = getStopTime(stop, 'arrival');
            const departure = getStopTime(stop, 'departure');

            if (!arrival || !departure) {
                continue;
            }

            if (!stop.code) {
                continue;
            }

            stops.push({
                index,
                code: stop.code,
                name: stop.name || stop.code,
                arrival,
                departure
            });
        }

        if (stops.length < 2) {
            continue;
        }

        const service = createJourneyService(train, stops);

        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];

            if (!servicesByStation.has(stop.code)) {
                servicesByStation.set(stop.code, []);
            }

            servicesByStation.get(stop.code).push({
                service,
                stopIndex: i
            });
        }
    }

    // Sorting here means the search can stop looking once services
    // are clearly too late for the requested departure time.
    for (const services of servicesByStation.values()) {
        services.sort((a, b) =>
            a.service.stops[a.stopIndex].departure -
            b.service.stops[b.stopIndex].departure
        );
    }

    return servicesByStation;
}


async function getJourneyIndex() {
    const now = Date.now();

    if (
        journeyCache.expiresAt > now &&
        journeyCache.servicesByStation.size > 0
    ) {
        return journeyCache.servicesByStation;
    }

    // Prevent multiple simultaneous requests from rebuilding
    // the exact same cache.
    if (!journeyCachePromise) {
        journeyCachePromise = buildJourneyIndex()
            .then(index => {
                journeyCache = {
                    expiresAt: Date.now() + JOURNEY_CONFIG.CACHE_TTL_MS,
                    servicesByStation: index
                };

                return index;
            })
            .finally(() => {
                journeyCachePromise = null;
            });
    }

    return journeyCachePromise;
}


// ============================================================
// Generate possible legs from one station
// ============================================================

function getPossibleLegs(
    stationCode,
    earliestDeparture,
    latestArrival,
    servicesByStation,
    usedTrains
) {
    const services = servicesByStation.get(stationCode) || [];
    const legs = [];

    for (const entry of services) {
        const service = entry.service;
        const boardIndex = entry.stopIndex;
        const boardStop = service.stops[boardIndex];

        // A train cannot be used twice in the same journey.
        if (usedTrains.has(service.trainNumber)) {
            continue;
        }

        // The train must be boardable after the earliest allowed time.
        if (boardStop.departure < earliestDeparture) {
            continue;
        }

        // Because the list is sorted by departure time, everything
        // after this point is also too late.
        //
        // This only matters when there is an upper bound on arrival,
        // but is still useful for limiting the search.
        if (
            latestArrival &&
            boardStop.departure > latestArrival
        ) {
            break;
        }

        for (
            let destinationIndex = boardIndex + 1;
            destinationIndex < service.stops.length;
            destinationIndex++
        ) {
            const destinationStop = service.stops[destinationIndex];

            // We cannot reach a destination before we depart.
            if (destinationStop.arrival <= boardStop.departure) {
                continue;
            }

            // If even this stop is already after arriveBefore,
            // later stops will also be too late.
            if (
                latestArrival &&
                destinationStop.arrival > latestArrival
            ) {
                break;
            }

            legs.push({
                trainNumber: service.trainNumber,
                operator: service.operator,
                routeNumber: service.routeNumber,

                from: {
                    code: boardStop.code,
                    name: boardStop.name,
                    time: boardStop.departure
                },

                to: {
                    code: destinationStop.code,
                    name: destinationStop.name,
                    time: destinationStop.arrival
                }
            });
        }
    }

    return legs;
}


// ============================================================
// Journey search
// ============================================================

function findJourneys(
    startStation,
    endStation,
    departureAfterDate,
    arriveBeforeDate,
    servicesByStation
) {
    const journeys = [];

    let statesExplored = 0;

    /*
     * Each state contains:
     *
     * currentCode
     * path
     * usedTrains
     *
     * We use a DFS because MAX_LEGS is very small (3).
     */

    function explore(currentCode, path, usedTrains) {
        statesExplored++;

        if (statesExplored > JOURNEY_CONFIG.MAX_SEARCH_STATES) {
            return;
        }

        // Destination reached.
        if (currentCode === endStation) {
            if (path.length > 0) {
                journeys.push(path);
            }

            return;
        }

        if (path.length >= JOURNEY_CONFIG.MAX_LEGS) {
            return;
        }

        // --------------------------------------------------------
        // Determine earliest possible departure from this station.
        // --------------------------------------------------------

        let earliestDeparture;

        if (path.length === 0) {
            earliestDeparture = departureAfterDate || new Date(0);
        } else {
            const previousArrival =
                path[path.length - 1].to.time;

            earliestDeparture = new Date(
                previousArrival.getTime() +
                JOURNEY_CONFIG.MIN_TRANSFER_MINUTES * 60_000
            );
        }

        // --------------------------------------------------------
        // Generate only legs starting at the station we're
        // currently searching from.
        // --------------------------------------------------------

        const legs = getPossibleLegs(
            currentCode,
            earliestDeparture,
            arriveBeforeDate,
            servicesByStation,
            usedTrains
        );

        for (const leg of legs) {
            // Never go back to the original departure station.
            if (leg.to.code === startStation) {
                continue;
            }

            // Avoid simple station loops.
            if (
                path.some(previousLeg =>
                    previousLeg.from.code === leg.to.code
                )
            ) {
                continue;
            }

            // Arrival must still satisfy arriveBefore.
            if (
                arriveBeforeDate &&
                leg.to.time > arriveBeforeDate
            ) {
                continue;
            }

            const nextUsedTrains = new Set(usedTrains);
            nextUsedTrains.add(leg.trainNumber);

            explore(
                leg.to.code,
                [...path, leg],
                nextUsedTrains
            );
        }
    }

    explore(
        startStation,
        [],
        new Set()
    );

    return journeys;
}


// ============================================================
// Remove duplicate journeys
// ============================================================

function deduplicateJourneys(journeys) {
    const unique = new Map();

    for (const journey of journeys) {
        const key = journey
            .map(leg =>
                `${leg.trainNumber}:${leg.from.code}:${leg.to.code}`
            )
            .join('|');

        if (!unique.has(key)) {
            unique.set(key, journey);
        }
    }

    return [...unique.values()];
}


// ============================================================
// Journey ranking
// ============================================================

function getJourneyDuration(journey) {
    const departure = journey[0].from.time;
    const arrival = journey[journey.length - 1].to.time;

    return arrival.getTime() - departure.getTime();
}


function sortJourneys(journeys) {
    return journeys.sort((a, b) => {
        const durationDifference =
            getJourneyDuration(a) -
            getJourneyDuration(b);

        if (durationDifference !== 0) {
            return durationDifference;
        }

        // If total duration is identical, prefer the journey
        // that arrives first.
        const arrivalA =
            a[a.length - 1].to.time.getTime();

        const arrivalB =
            b[b.length - 1].to.time.getTime();

        if (arrivalA !== arrivalB) {
            return arrivalA - arrivalB;
        }

        // Finally prefer fewer changes.
        return a.length - b.length;
    });
}


// ============================================================
// Convert result to API format
// ============================================================

function formatJourneyResult(journey) {
    return journey.map(leg => ({
        trainNumber: leg.trainNumber,
        operator: leg.operator,
        routeNumber: leg.routeNumber,

        from: {
            code: leg.from.code,
            name: leg.from.name,
            time: formatJourneyTime(leg.from.time)
        },

        to: {
            code: leg.to.code,
            name: leg.to.name,
            time: formatJourneyTime(leg.to.time)
        }
    }));
}

module.exports = {
    deduplicateJourneys,
    sortJourneys,
    formatJourneyResult,
    getJourneyDuration
};