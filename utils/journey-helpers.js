const { DateTime } = require('luxon');
const trains = require('./train.js');

const passengerArrivalStopTypes = ['passenger', 'passenger-A', 'passenger-X', 'passenger-AX'];
const passengerDepartureStopTypes = ['passenger', 'passenger-P', 'passenger-X', 'passenger-XP'];

// ============================================================
// Journey search configuration
// ============================================================

const JOURNEY_CONFIG = {
    MAX_LEGS: 3,
    MAX_RESULTS: 10,

    // Minimum time required to transfer between trains.
    MIN_TRANSFER_MINUTES: 1,

    // Longest acceptable wait when changing trains.
    MAX_TRANSFER_WAIT_MINUTES: 120,

    // How far from the requested time the search looks: after
    // departureAfter, or before arriveBefore.
    SEARCH_WINDOW_HOURS: 12,

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

function isPassengerArrivalStop(stop) {
    return Boolean(
        stop &&
        passengerArrivalStopTypes.includes(stop.stopType)
    );
}

function isPassengerDepartureStop(stop) {
    return Boolean(
        stop &&
        passengerDepartureStopTypes.includes(stop.stopType)
    );
}

function getScheduledDeparture(train) {
    const currentRoute = train?.currentRoute || [];
    const departureIndex = currentRoute.findIndex(stop => stop?.departure);

    if (departureIndex === -1) {
        return null;
    }

    const currentStop = currentRoute[departureIndex];
    const scheduledStop = train.defaultRoute?.[departureIndex]?.code === currentStop.code
        ? train.defaultRoute[departureIndex]
        : train.defaultRoute?.find(stop => stop.code === currentStop.code);
    const scheduledDeparture = getPlannedTime(
        scheduledStop?.departure,
        currentStop.departure
    );

    return scheduledDeparture && !Number.isNaN(scheduledDeparture.getTime())
        ? scheduledDeparture.getTime()
        : null;
}

function sortTrainsByScheduledDeparture(trainList) {
    return [...trainList].sort((a, b) => {
        const departureA = getScheduledDeparture(a);
        const departureB = getScheduledDeparture(b);

        if (departureA === null) return departureB === null ? 0 : 1;
        if (departureB === null) return -1;

        return departureA - departureB;
    });
}

// Planned times are stored as { hours, minutes } in Norwegian local time.
// Place them on the same day as the real time so the two can be compared.
function getPlannedTime(planned, actual) {
    if (
        !planned ||
        typeof planned.hours !== 'number' ||
        typeof planned.minutes !== 'number'
    ) {
        return null;
    }

    const base = actual
        ? DateTime.fromJSDate(actual, { zone: 'Europe/Oslo' })
        : DateTime.now().setZone('Europe/Oslo');

    let result = base.set({
        hour: planned.hours,
        minute: planned.minutes,
        second: 0,
        millisecond: 0
    });

    if (actual) {
        const difference = result.toMillis() - base.toMillis();

        if (difference > 12 * 3_600_000) {
            result = result.minus({ days: 1 });
        } else if (difference < -12 * 3_600_000) {
            result = result.plus({ days: 1 });
        }
    }

    return result.toJSDate();
}

function findDefaultStop(train, index, code) {
    const route = train.defaultRoute || [];

    return route[index]?.code === code
        ? route[index]
        : route.find(stop => stop.code === code);
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
                currentRoute: 1,
                defaultRoute: 1
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

            if (!stop) {
                continue;
            }

            // Arrival is cancelled if this stop or the previous stop is
            // cancelled; departure if this stop or the next stop is.
            const route = train.currentRoute;
            const arrivalCancelled =
                stop.cancelledAtStation ||
                route[index - 1]?.cancelledAtStation;
            const departureCancelled =
                stop.cancelledAtStation ||
                route[index + 1]?.cancelledAtStation;

            const arrival = isPassengerArrivalStop(stop)
                ? getStopTime(stop, 'arrival')
                : null;
            const departure = isPassengerDepartureStop(stop)
                ? getStopTime(stop, 'departure')
                : null;

            if (!arrival && !departure) continue;

            if (!stop.code) {
                continue;
            }

            const defaultStop = findDefaultStop(train, index, stop.code);

            stops.push({
                index,
                code: stop.code,
                name: stop.name || stop.code,
                stopType: stop.stopType,
                arrival,
                departure,
                plannedArrival: getPlannedTime(defaultStop?.arrival, arrival),
                plannedDeparture: getPlannedTime(defaultStop?.departure, departure),
                arrivalCancelled: Boolean(arrivalCancelled),
                departureCancelled: Boolean(departureCancelled)
            });
        }

        if (stops.length < 2) {
            continue;
        }

        const service = createJourneyService(train, stops);

        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];

            // Only stops where passengers are allowed to board
            // should be added to the boarding index.
            if (!isPassengerDepartureStop(stop) || !stop.departure) {
                continue;
            }

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
    latestDeparture,
    latestArrival,
    servicesByStation,
    usedTrains,
    visitedStations,
    includeCancelled
) {
    const services = servicesByStation.get(stationCode) || [];
    const legs = [];

    // The list is sorted by departure time, so jump straight to the
    // first service that can still be boarded.
    let low = 0;
    let high = services.length;

    while (low < high) {
        const mid = (low + high) >> 1;
        const entry = services[mid];

        if (entry.service.stops[entry.stopIndex].departure < earliestDeparture) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    for (let i = low; i < services.length; i++) {
        const entry = services[i];
        const service = entry.service;
        const boardIndex = entry.stopIndex;
        const boardStop = service.stops[boardIndex];

        // You can only board at a passenger departure stop.
        if (!isPassengerDepartureStop(boardStop) || !boardStop.departure) {
            continue;
        }

        // Cancelled departures are only offered when explicitly requested.
        if (boardStop.departureCancelled && !includeCancelled) {
            continue;
        }

        // A train cannot be used twice in the same journey.
        if (usedTrains.has(service.trainNumber)) {
            continue;
        }

        // Sorted by departure, so everything after this is too late too.
        if (boardStop.departure > latestDeparture) {
            break;
        }

        for (
            let destinationIndex = boardIndex + 1;
            destinationIndex < service.stops.length;
            destinationIndex++
        ) {
            const destinationStop = service.stops[destinationIndex];

            // Do not continue along a train after it passes a station
            // this journey has already visited.
            if (visitedStations.has(destinationStop.code)) {
                break;
            }

            // You can only leave the train at a passenger arrival stop.
            if (!isPassengerArrivalStop(destinationStop) || !destinationStop.arrival) {
                continue;
            }

            if (destinationStop.arrivalCancelled && !includeCancelled) {
                continue;
            }

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
                    time: boardStop.departure,
                    plannedTime: boardStop.plannedDeparture
                },

                to: {
                    code: destinationStop.code,
                    name: destinationStop.name,
                    time: destinationStop.arrival,
                    plannedTime: destinationStop.plannedArrival
                },

                cancelled: Boolean(
                    boardStop.departureCancelled ||
                    destinationStop.arrivalCancelled
                )
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
    servicesByStation,
    includeCancelled = false
) {
    const journeys = [];
    const windowMs = JOURNEY_CONFIG.SEARCH_WINDOW_HOURS * 3_600_000;

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
            if (statesExplored === JOURNEY_CONFIG.MAX_SEARCH_STATES + 1) {
                console.warn(
                    `Journey search ${startStation} -> ${endStation} hit the state limit; results may be incomplete.`
                );
            }

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
        let latestDeparture;

        if (path.length === 0) {
            if (arriveBeforeDate) {
                earliestDeparture = new Date(arriveBeforeDate.getTime() - windowMs);
                latestDeparture = arriveBeforeDate;
            } else {
                earliestDeparture = departureAfterDate;
                latestDeparture = new Date(departureAfterDate.getTime() + windowMs);
            }
        } else {
            const previousArrival =
                path[path.length - 1].to.time;

            earliestDeparture = new Date(
                previousArrival.getTime() +
                JOURNEY_CONFIG.MIN_TRANSFER_MINUTES * 60_000
            );

            latestDeparture = new Date(
                previousArrival.getTime() +
                JOURNEY_CONFIG.MAX_TRANSFER_WAIT_MINUTES * 60_000
            );

            if (arriveBeforeDate && latestDeparture > arriveBeforeDate) {
                latestDeparture = arriveBeforeDate;
            }
        }

        // --------------------------------------------------------
        // Generate only legs starting at the station we're
        // currently searching from.
        // --------------------------------------------------------

        const legs = getPossibleLegs(
            currentCode,
            earliestDeparture,
            latestDeparture,
            arriveBeforeDate,
            servicesByStation,
            usedTrains,
            new Set([
                startStation,
                ...path.map(leg => leg.to.code)
            ]),
            includeCancelled
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

// Journeys using the same trains in the same order only differ in where
// the change happens. Keep the one that changes at the earliest point.
function keepEarliestTransferPoints(journeys) {
    const bySequence = new Map();

    for (const journey of journeys) {
        const key = journey.map(leg => leg.trainNumber).join('>');
        const existing = bySequence.get(key);

        if (!existing) {
            bySequence.set(key, journey);
            continue;
        }

        for (let i = 0; i < journey.length - 1; i++) {
            const difference =
                journey[i].to.time.getTime() -
                existing[i].to.time.getTime();

            if (difference < 0) {
                bySequence.set(key, journey);
            }

            if (difference !== 0) {
                break;
            }
        }
    }

    return [...bySequence.values()];
}

// Journey `other` dominates `journey` if it leaves no earlier, arrives no
// later and has no more legs, and is strictly better in at least one of them.
function dominates(other, journey) {
    const otherDeparture = other[0].from.time.getTime();
    const otherArrival = other[other.length - 1].to.time.getTime();
    const departure = journey[0].from.time.getTime();
    const arrival = journey[journey.length - 1].to.time.getTime();

    if (
        otherDeparture < departure ||
        otherArrival > arrival ||
        other.length > journey.length
    ) {
        return false;
    }

    return (
        otherDeparture > departure ||
        otherArrival < arrival ||
        other.length < journey.length
    );
}

// Cancelled and running journeys are filtered separately, so a cancelled
// journey never hides a running one (or the other way around).
function filterJourneyAlternatives(journeys) {
    const isCancelled = journey => journey.some(leg => leg.cancelled);

    return [
        ...filterRunningAlternatives(journeys.filter(j => !isCancelled(j))),
        ...filterRunningAlternatives(journeys.filter(isCancelled))
    ];
}

function filterRunningAlternatives(journeys) {
    const candidates = keepEarliestTransferPoints(journeys);

    return candidates.filter(journey =>
        !candidates.some(other => dominates(other, journey))
    );
}

// ============================================================
// Journey ranking
// ============================================================

function getJourneyDuration(journey) {
    const departure = journey[0].from.time;
    const arrival = journey[journey.length - 1].to.time;

    return arrival.getTime() - departure.getTime();
}

// departureAfter: earliest arrival first, then the latest departure
// (least waiting). arriveBefore: latest departure first (leave as late as
// possible), then the earliest arrival. Fewer legs breaks any remaining tie.
function sortJourneys(journeys, { arriveBefore = false } = {}) {
    return journeys.sort((a, b) => {
        const departureA = a[0].from.time.getTime();
        const departureB = b[0].from.time.getTime();
        const arrivalA = a[a.length - 1].to.time.getTime();
        const arrivalB = b[b.length - 1].to.time.getTime();

        const byDeparture = departureB - departureA;
        const byArrival = arrivalA - arrivalB;

        const [first, second] = arriveBefore
            ? [byDeparture, byArrival]
            : [byArrival, byDeparture];

        if (first !== 0) return first;
        if (second !== 0) return second;

        return a.length - b.length;
    });
}

// ============================================================
// Convert result to API format
// ============================================================

function formatJourneyResult(journey) {
    const formatStop = stop => ({
        code: stop.code,
        name: stop.name,
        time: formatJourneyTime(stop.time),
        plannedTime: stop.plannedTime
            ? formatJourneyTime(stop.plannedTime)
            : null,
        delayMinutes: stop.plannedTime
            ? Math.round((stop.time.getTime() - stop.plannedTime.getTime()) / 60_000)
            : null
    });

    return journey.map(leg => ({
        trainNumber: leg.trainNumber,
        operator: leg.operator,
        routeNumber: leg.routeNumber,
        cancelled: leg.cancelled,
        from: formatStop(leg.from),
        to: formatStop(leg.to)
    }));
}

module.exports = {
    deduplicateJourneys,
    filterJourneyAlternatives,
    sortJourneys,
    formatJourneyResult,
    getJourneyDuration,
    findJourneys,
    parseJourneyDateTime,
    getJourneyIndex,
    sortTrainsByScheduledDeparture,
    JOURNEY_CONFIG
};