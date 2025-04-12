const CronJob = require('cron').CronJob;
const trains = require('./utils/train');
const servers = require('./utils/server');
const { DateTime } = require('luxon');

console.log('Timers are running...');

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

function isRailwayActive() {
    const allServers = servers.find({});
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

    const newLocationsArrivals = {
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
    const newLocationsDepartures = {
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

    const isRailwayActiveNow = isRailwayActive();
    
    allTrains.forEach(train => {
        if (isRailwayActiveNow || train.currentRoute[0].arrival > new Date()) {
            train.currentRoute.forEach(location => {
                if (!newLocationsArrivals[location.code]) {
                    newLocationsArrivals[location.code] = {}; // Fix: Initialize station code if it doesn’t exist
                }
                if (!newLocationsDepartures[location.code]) {
                    newLocationsDepartures[location.code] = {}; // Fix: Initialize station code if it doesn’t exist
                }
    
                //Convert times to Norwegian time
                const norwegianArrival = DateTime.fromJSDate(location.arrival, { zone: 'UTC' }).setZone('Europe/Oslo');
                const norwegianDeparture = DateTime.fromJSDate(location.departure, { zone: 'UTC' }).setZone('Europe/Oslo');
    
                const norwegianArrivalTime = {
                    hours: norwegianArrival.hour,
                    minutes: norwegianArrival.minute
                };
                const norwegianDepartureTime = {
                    hours: norwegianDeparture.hour,
                    minutes: norwegianDeparture.minute
                };
    
                const index = train.defaultRoute.findIndex(station => station.code === location.code);
                const isLast = train.currentRoute.findIndex(station => station.code === location.code) === train.currentRoute.length - 1;
                const isFirst = train.currentRoute.findIndex(station => station.code === location.code) === 0;
    
                const defaultArrival = DateTime.fromObject({hour: train.defaultRoute[index].arrival.hours, minute: train.defaultRoute[index].arrival.minutes}, { zone: 'Europe/Oslo' });
                const defaultDeparture = DateTime.fromObject({hour: train.defaultRoute[index].departure.hours, minute: train.defaultRoute[index].departure.minutes}, { zone: 'Europe/Oslo' });
    
                const norwegianDefaultArrivalTime = {
                    hours: defaultArrival.hour,
                    minutes: defaultArrival.minute
                }
    
                const norwegianDefaultDepartureTime = {
                    hours: defaultDeparture.hour,
                    minutes: defaultDeparture.minute
                }
    
                const arrivalDelay = (norwegianArrival.toMillis() - defaultArrival.toMillis()) / 60_000;
                const departureDelay = (norwegianDeparture.toMillis() - defaultDeparture.toMillis()) / 60_000;
                
                if (!isFirst) {
                    newLocationsArrivals[location.code][train.trainNumber] = { 
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
                        norwegianArrival: norwegianArrivalTime,
                        norwegianDefaultArrival: norwegianDefaultArrivalTime,
                        arrivalDelay: arrivalDelay,
                        departure: location.departure,
                        defaultDeparture: defaultDeparture.toJSDate(),
                        norwegianDeparture: norwegianDepartureTime,
                        norwegianDefaultDeparture: norwegianDefaultDepartureTime,
                        departureDelay: departureDelay,
                        fullRoute: train.currentRoute
                    };
                }
    
                if (!isLast) {
                    newLocationsDepartures[location.code][train.trainNumber] = {
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
                        norwegianArrival: norwegianArrivalTime,
                        norwegianDefaultArrival: norwegianDefaultArrivalTime,
                        arrivalDelay: arrivalDelay,
                        departure: location.departure,
                        defaultDeparture: defaultDeparture.toJSDate(),
                        norwegianDeparture: norwegianDepartureTime,
                        norwegianDefaultDeparture: norwegianDefaultDepartureTime,
                        departureDelay: departureDelay,
                        fullRoute: train.currentRoute
                    };
                };
            });
        } else {
            train.currentRoute.forEach(location => {
                location.cancelledAtStation = true; // Mark the train as cancelled at the station
            });
            train.markModified('currentRoute'); // Mark the currentRoute field as modified
            train.save(); // Save the changes to the train document
        };
    });
            
    // Sort the trains at each location by arrival time
    Object.keys(newLocationsArrivals).forEach(location => {
        newLocationsArrivals[location] = Object.values(newLocationsArrivals[location]).sort((a, b) => a.defaultArrival - b.defaultArrival);
    });

    // Sort the trains at each location by departure time
    Object.keys(newLocationsDepartures).forEach(location => {
        newLocationsDepartures[location] = Object.values(newLocationsDepartures[location]).sort((a, b) => a.defaultDeparture - b.defaultDeparture);
    });

    // Update locations with new data
    Object.keys(locationsArrivals).forEach(key => delete locationsArrivals[key]); // Clear existing data
    Object.assign(locationsArrivals, newLocationsArrivals); // Copy new data into existing object

    Object.keys(locationsDepartures).forEach(key => delete locationsDepartures[key]); // Clear existing data
    Object.assign(locationsDepartures, newLocationsDepartures); // Copy new data into existing object
}

// Every 40th second of every minute
const fiveMinutesTimer = new CronJob('40 * * * * *', updateLocations, null, false, 'Europe/Oslo');
updateLocations();


module.exports = { dayTimer, fiveMinutesTimer, locationsArrivals, locationsDepartures, updateLocations };

