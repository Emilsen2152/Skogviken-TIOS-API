const CronJob = require('cron').CronJob;
const trains = require('./utils/train');
const servers = require('./utils/server');
const { DateTime } = require('luxon');

console.log('Timers are running...');

const clockControlledLocations = [
    'RUS', // Rustfjelbma
    'IST', // Inso tømmer A/S sidespor
    'MAS', // Masjok
    'RKS', // Ruskka A/S sidespor
];

const locationsArrivals = {
    RUS: [],
    IST: [],
    MAS: [],
    RSK: [],
    SK: [],
    SIG: [],
    SIP: [],
    VBT: [],
    KLH: []
};
const locationsDepartures = {
    RUS: [],
    IST: [],
    MAS: [],
    RSK: [],
    SK: [],
    SIG: [],
    SIP: [],
    VBT: [],
    KLH: []
};

const locationNames = {
    RUS: 'Rustfjelbma',
    IST: 'Inso tømmer A/S sidespor',
    MAS: 'Masjok',
    RSK: 'Ruskka A/S sidespor',
    SK: 'Skogviken',
    SIG: 'Skiippagurra',
    SIP: 'Skiippagurra-Sletta',
    VBT: 'Varangerbotn',
    KLH: 'Kirkenes Lufthavn Høybuktmoen'
}

async function isRailwayActive() {
    const allServers = await servers.find({}).exec();
    let activeRailwayWorkers = 0;
    allServers.forEach(server => {
        activeRailwayWorkers += server.activeRailwayWorkers;
    });

    return activeRailwayWorkers > 0;
}

// New day timer
const dayTimer = new CronJob('0 0 0 * * *', async () => {
    const allTrains = await trains.find({});

    for (const train of allTrains) {
        if (train.extraTrain) {
            await train.deleteOne();
        } else {
            train.currentRoute = train.defaultRoute.map(station => {
                const {
                    name,
                    code,
                    type,
                    track,
                    arrival,
                    departure,
                    stopType,
                    passed,
                    cancelledAtStation
                } = station;

                // Convert Oslo time to UTC using Luxon
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
                    passed,
                    cancelledAtStation
                };
            });

            train.currentFormation = {};
            await train.save();
        }
    }
}, null, false, 'Europe/Oslo');

async function updateLocations() {
    const allTrains = await trains.find({});

    const newLocationsArrivals = { RUS: [], IST: [], MAS: [], RSK: [], SK: [], SIG: [], SIP: [], VBT: [], KLH: [] };
    const newLocationsDepartures = { RUS: [], IST: [], MAS: [], RSK: [], SK: [], SIG: [], SIP: [], VBT: [], KLH: [] };
    const newLocationNames = {
        RUS: 'Rustfjelbma',
        IST: 'Inso tømmer A/S sidespor',
        MAS: 'Masjok',
        RSK: 'Ruskka A/S sidespor',
        SK: 'Skogviken',
        SIG: 'Skiippagurra',
        SIP: 'Skiippagurra-Sletta',
        VBT: 'Varangerbotn',
        KLH: 'Kirkenes Lufthavn Høybuktmoen'
    };

    const isRailwayActiveNow = await isRailwayActive();
    const modifiedTrains = [];

    for (const train of allTrains) {
        if (!isRailwayActiveNow && train.currentRoute[0].arrival > new Date() && train.currentRoute[0].passed === false && train.currentRoute[0].cancelledAtStation === false) {
            // If the railway is not active and the train has not passed the first station, mark all locations as cancelled
            train.currentRoute.forEach(location => {
                location.cancelledAtStation = true;
            });
            train.markModified('currentRoute');
        }

        for (let currentIndex = 0; currentIndex < train.currentRoute.length; currentIndex++) {
            const location = train.currentRoute[currentIndex];
            const index = train.defaultRoute.findIndex(station => station.code === location.code);
            if (index === -1) continue;

            if (!newLocationsArrivals[location.code]) newLocationsArrivals[location.code] = {};
            if (!newLocationsDepartures[location.code]) newLocationsDepartures[location.code] = {};
            if (!newLocationNames[location.code]) newLocationNames[location.code] = location.name;
            const currentDate = new Date();
            currentDate.setSeconds(0, 0);

            const isHoldeplass = location.type === 'holdeplass';

            if (isHoldeplass) {
                const lastLocation = train.currentRoute[currentIndex - 1];
                if (lastLocation && lastLocation.passed && !location.passed && !location.cancelledAtStation && location.departure <= currentDate) {
                    location.passed = true;
                    train.markModified('currentRoute');
                }
            }

            const isClockControlled = clockControlledLocations.includes(location.code);

            if (isClockControlled && !location.passed && !location.cancelledAtStation && location.departure <= currentDate) {
                location.passed = true;
                train.markModified('currentRoute');
            }

            if (!location.passed && !location.cancelledAtStation && location.departure < currentDate) {
                location.departure = currentDate;
                train.markModified('currentRoute');
            }

            const norwegianArrival = DateTime.fromJSDate(location.arrival, { zone: 'UTC' }).setZone('Europe/Oslo');
            const norwegianDeparture = DateTime.fromJSDate(location.departure, { zone: 'UTC' }).setZone('Europe/Oslo');

            // Ensure both norwegianArrival and norwegianDeparture are valid
            if (!norwegianArrival.isValid || !norwegianDeparture.isValid) {
                console.error(`Invalid norwegianArrival or norwegianDeparture for train: ${train.trainNumber} at location: ${location.code}`);
                continue;
            }

            const defaultArrival = DateTime.fromObject(train.defaultRoute[index].arrival, { zone: 'Europe/Oslo' });
            const defaultDeparture = DateTime.fromObject(train.defaultRoute[index].departure, { zone: 'Europe/Oslo' });

            // Ensure defaultArrival and defaultDeparture are valid
            if (!defaultArrival.isValid || !defaultDeparture.isValid) {
                console.error(`Invalid defaultArrival or defaultDeparture for train: ${train.trainNumber} at location: ${location.code}`);
                continue;
            }

            const arrivalDelay = (norwegianArrival.toMillis() - defaultArrival.toMillis()) / 60_000;
            const departureDelay = (norwegianDeparture.toMillis() - defaultDeparture.toMillis()) / 60_000;

            const isFirst = currentIndex === 0;
            const isLast = currentIndex === train.currentRoute.length - 1;

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

            if (!isFirst) {
                newLocationsArrivals[location.code][train.trainNumber] = stationData;
            }
            if (!isLast) {
                newLocationsDepartures[location.code][train.trainNumber] = stationData;
            }
        }

        modifiedTrains.push(train);
    }

    // Save all modified trains in parallel
    await Promise.all(modifiedTrains.map(train => train.save()));

    // Sort arrivals
    Object.keys(newLocationsArrivals).forEach(location => {
        newLocationsArrivals[location] = Object.values(newLocationsArrivals[location]).sort((a, b) => a.defaultArrival - b.defaultArrival);
    });

    // Sort departures
    Object.keys(newLocationsDepartures).forEach(location => {
        newLocationsDepartures[location] = Object.values(newLocationsDepartures[location]).sort((a, b) => a.defaultDeparture - b.defaultDeparture);
    });

    // Update the global objects
    Object.keys(locationsArrivals).forEach(key => delete locationsArrivals[key]);
    Object.assign(locationsArrivals, newLocationsArrivals);

    Object.keys(locationsDepartures).forEach(key => delete locationsDepartures[key]);
    Object.assign(locationsDepartures, newLocationsDepartures);

    Object.keys(locationNames).forEach(key => delete locationNames[key]);
    Object.assign(locationNames, newLocationNames);
}


// Every 40th second of every minute
const locationUpdateTimer = new CronJob('40 * * * * *', updateLocations, null, false, 'Europe/Oslo');
updateLocations();


module.exports = { dayTimer, locationUpdateTimer, locationsArrivals, locationsDepartures, locationNames, updateLocations };

