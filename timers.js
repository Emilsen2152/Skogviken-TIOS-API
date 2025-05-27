const CronJob = require('cron').CronJob;
const trains = require('./utils/train');
const servers = require('./utils/server');
const { DateTime } = require('luxon');

console.log('Timers are running...');

// Location definitions
const LOCATION_CODES = {
    RUS: 'Rustfjelbma',
    IST: 'Inso tømmer A/S sidespor',
    MAS: 'Masjok',
    RSK: 'Ruskka A/S sidespor',
    SK: 'Skogviken',
    SIG: 'Skiippagurra',
    DOV: 'Drifts og vedlikeholds base',
    SIP: 'Skiippagurra-Sletta',
    VBT: 'Varangerbotn',
    KLH: 'Kirkenes Lufthavn Høybuktmoen'
};

const clockControlledLocations = ['RUS', 'IST', 'MAS', 'RSK', 'DOV'];

const locationsArrivals = Object.fromEntries(Object.keys(LOCATION_CODES).map(k => [k, []]));
const locationsDepartures = Object.fromEntries(Object.keys(LOCATION_CODES).map(k => [k, []]));
const locationNames = { ...LOCATION_CODES };

async function isRailwayActive() {
    const allServers = await servers.find({}).lean().exec();
    return allServers.reduce((acc, server) => acc + (server.activeRailwayWorkers || 0), 0) > 0;
}

const autoCancelledStops = {
    SK: {
        start: DateTime.fromObject(
            { year: 2025, month: 5, day: 26, hour: 18, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        end: DateTime.fromObject(
            { year: 2025, month: 5, day: 29, hour: 4, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        routes: ['RE80'],
        trains: ['91105', '91116'],
        all: false
    },
    SIG: {
        start: DateTime.fromObject(
            { year: 2025, month: 5, day: 26, hour: 18, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        end: DateTime.fromObject(
            { year: 2025, month: 5, day: 29, hour: 4, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        routes: ['RE80'],
        trains: ['91105', '91116'],
        all: false
    },
    SIP: {
        start: DateTime.fromObject(
            { year: 2025, month: 5, day: 26, hour: 18, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        end: DateTime.fromObject(
            { year: 2025, month: 5, day: 29, hour: 4, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        routes: [],
        trains: [],
        all: true
    },
    VBT: {
        start: DateTime.fromObject(
            { year: 2025, month: 5, day: 26, hour: 18, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        end: DateTime.fromObject(
            { year: 2025, month: 5, day: 29, hour: 4, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        routes: [],
        trains: [],
        all: true
    },
    KLH: {
        start: DateTime.fromObject(
            { year: 2025, month: 5, day: 26, hour: 18, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        end: DateTime.fromObject(
            { year: 2025, month: 5, day: 29, hour: 4, minute: 0 },
            { zone: 'Europe/Oslo' }
        ),
        routes: [],
        trains: [],
        all: true
    }
}

async function dayReset() {
    const allTrains = await trains.find({});

    for (const train of allTrains) {
        if (train.extraTrain) {
            await train.deleteOne();
        } else {
            train.currentRoute = train.defaultRoute.map(station => {
                const {
                    name, code, type, track, arrival, departure,
                    stopType, passed, cancelledAtStation
                } = station;

                const arrivalUTC = DateTime.fromObject(
                    { hour: arrival.hours, minute: arrival.minutes },
                    { zone: 'Europe/Oslo' }
                ).toUTC().toJSDate();

                const departureUTC = DateTime.fromObject(
                    { hour: departure.hours, minute: departure.minutes },
                    { zone: 'Europe/Oslo' }
                ).toUTC().toJSDate();

                return {
                    name, code, type, track,
                    arrival: arrivalUTC,
                    departure: departureUTC,
                    stopType,
                    passed,
                    cancelledAtStation
                };
            });

            let currentRouteChanged = false;

            train.currentRoute.forEach(location => {
                const departureTime = DateTime.fromJSDate(location.departure).setZone('Europe/Oslo');
                if (departureTime < DateTime.now().setZone('Europe/Oslo')) {
                    location.cancelledAtStation = true;
                    currentRouteChanged = true;
                } else if (autoCancelledStops[location.code]) {
                    if (!autoCancelledStops[location.code].routes.includes(train.routeNumber) && !autoCancelledStops[location.code].trains.includes(train.trainNumber) && !autoCancelledStops[location.code].all) {
                        return;
                    }
                    const cancelStart = autoCancelledStops[location.code].start;
                    const cancelEnd = autoCancelledStops[location.code].end;

                    if (departureTime >= cancelStart && departureTime <= cancelEnd) {
                        location.cancelledAtStation = true;
                        currentRouteChanged = true;
                    }
                }
            });

            if (currentRouteChanged) {
                train.markModified('currentRoute');
            };

            train.currentFormation = {};
            await train.save();
        }
    }
}

const dayTimer = new CronJob('0 0 0 * * *', dayReset, null, false, 'Europe/Oslo');

function calculateDelay(actual, planned) {
    return (actual.toMillis() - planned.toMillis()) / 60_000;
}

async function updateLocations() {
    const allTrains = await trains.find({});
    const newLocationsArrivals = Object.fromEntries(Object.keys(LOCATION_CODES).map(k => [k, {}]));
    const newLocationsDepartures = Object.fromEntries(Object.keys(LOCATION_CODES).map(k => [k, {}]));
    const newLocationNames = { ...LOCATION_CODES };

    const isRailwayActiveNow = await isRailwayActive();
    const currentDate = new Date();
    currentDate.setSeconds(0, 0);

    const modifiedTrains = [];

    for (const train of allTrains) {
        let routeModified = false;

        if (
            !isRailwayActiveNow &&
            train.currentRoute.length > 0 &&
            train.currentRoute[0].arrival.getTime() < Date.now()
        ) {
            console.log(`Marking all locations as cancelled for train: ${train.trainNumber}`);
            train.currentRoute.forEach(location => {
                if (location.cancelledAtStation || location.passed) return;
                location.cancelledAtStation = true;
                routeModified = true;
            });
        }

        for (let currentIndex = 0; currentIndex < train.currentRoute.length; currentIndex++) {
            const location = train.currentRoute[currentIndex];
            if (!location.arrival || !location.departure) continue;

            const index = train.defaultRoute.findIndex(station => station.code === location.code);
            if (index === -1) continue;

            const isHoldeplass = location.type === 'holdeplass';
            const isClockControlled = clockControlledLocations.includes(location.code);
            const isFirst = currentIndex === 0;
            const isLast = currentIndex === train.currentRoute.length - 1;

            if (isHoldeplass) {
                const lastLocation = train.currentRoute[currentIndex - 1];
                if (lastLocation && lastLocation.passed && !location.passed && !location.cancelledAtStation && location.departure <= currentDate) {
                    location.passed = true;
                    routeModified = true;
                }
            }

            if (isClockControlled && !location.passed && !location.cancelledAtStation && location.departure <= currentDate) {
                location.passed = true;
                routeModified = true;
            }

            if (!location.passed && !location.cancelledAtStation && location.departure < currentDate) {
                location.departure = currentDate;
                routeModified = true;
            }

            const norwegianArrival = DateTime.fromJSDate(location.arrival, { zone: 'UTC' }).setZone('Europe/Oslo');
            const norwegianDeparture = DateTime.fromJSDate(location.departure, { zone: 'UTC' }).setZone('Europe/Oslo');

            if (!norwegianArrival.isValid || !norwegianDeparture.isValid) {
                console.error(`Invalid time for train: ${train.trainNumber} at ${location.code}`);
                continue;
            }

            const defaultArrival = DateTime.fromObject(train.defaultRoute[index].arrival, { zone: 'Europe/Oslo' });
            const defaultDeparture = DateTime.fromObject(train.defaultRoute[index].departure, { zone: 'Europe/Oslo' });

            if (!defaultArrival.isValid || !defaultDeparture.isValid) {
                console.error(`Invalid default time for train: ${train.trainNumber} at ${location.code}`);
                continue;
            }

            const arrivalDelay = calculateDelay(norwegianArrival, defaultArrival);
            const departureDelay = calculateDelay(norwegianDeparture, defaultDeparture);

            const stationData = {
                trainNumber: train.trainNumber,
                operator: train.operator,
                extraTrain: train.extraTrain,
                routeNumber: train.routeNumber,
                type: location.type,
                stopType: location.stopType,
                hasPassed: location.passed,
                isCancelledAtStation: location.cancelledAtStation,
                track: location.track,
                defaultTrack: train.defaultRoute[index].track,
                arrival: location.arrival,
                defaultArrival: defaultArrival.toJSDate(),
                norwegianArrival: { hours: norwegianArrival.hour, minutes: norwegianArrival.minute },
                norwegianDefaultArrival: { hours: defaultArrival.hour, minutes: defaultArrival.minute },
                arrivalDelay,
                departure: location.departure,
                defaultDeparture: defaultDeparture.toJSDate(),
                norwegianDeparture: { hours: norwegianDeparture.hour, minutes: norwegianDeparture.minute },
                norwegianDefaultDeparture: { hours: defaultDeparture.hour, minutes: defaultDeparture.minute },
                departureDelay,
                fullRoute: train.currentRoute
            };

            if (!isFirst) newLocationsArrivals[location.code][train.trainNumber] = stationData;
            if (!isLast) newLocationsDepartures[location.code][train.trainNumber] = stationData;
        }

        if (routeModified) {
            train.markModified('currentRoute');
            modifiedTrains.push(train);
        }
    }

    await Promise.all(modifiedTrains.map(train => train.save()));

    for (const [code, arrivals] of Object.entries(newLocationsArrivals)) {
        newLocationsArrivals[code] = Object.values(arrivals).sort((a, b) => a.defaultArrival - b.defaultArrival);
    }

    for (const [code, departures] of Object.entries(newLocationsDepartures)) {
        newLocationsDepartures[code] = Object.values(departures).sort((a, b) => a.defaultDeparture - b.defaultDeparture);
    }

    Object.keys(locationsArrivals).forEach(key => delete locationsArrivals[key]);
    Object.assign(locationsArrivals, newLocationsArrivals);

    Object.keys(locationsDepartures).forEach(key => delete locationsDepartures[key]);
    Object.assign(locationsDepartures, newLocationsDepartures);

    Object.keys(locationNames).forEach(key => delete locationNames[key]);
    Object.assign(locationNames, newLocationNames);
}

const locationUpdateTimer = new CronJob('40 * * * * *', updateLocations, null, false, 'Europe/Oslo');

module.exports = {
    dayTimer,
    locationUpdateTimer,
    locationsArrivals,
    locationsDepartures,
    locationNames,
    updateLocations,
    dayReset
};
