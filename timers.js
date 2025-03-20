const CronJob = require('cron').CronJob;
const trains = require('./utils/train');

console.log('Timers are running...');

const locationsArrivals = {};
const locationsDepartures = {};

// New day timer
const dayTimer = new CronJob('0 0 0 * * *', async () => {
    const allTrains = await trains.find({});
    for (const train of allTrains) {
        if (train.extraTrain) {
            await train.deleteOne();
        } else {
            // Get the current local date in Norway using "sv-SE"
            const nowOsloStr = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Oslo" });
            const [datePart] = nowOsloStr.split(" ");
            const [year, month, day] = datePart.split("-").map(Number);

            train.currentRoute = train.defaultRoute.map(station => {
                const { name, code, type, track, arrival, departure, stopType, passed, cancelledAtStation } = station;

                // Build UTC dates for arrival and departure using the Norwegian local date
                const arrivalUTC = new Date(Date.UTC(year, month - 1, day, arrival.hours, arrival.minutes, 0, 0));
                const departureUTC = new Date(Date.UTC(year, month - 1, day, departure.hours, departure.minutes, 0, 0));

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

    const newLocationsArrivals = {};
    const newLocationsDepartures = {};
    
    allTrains.forEach(train => {
        train.currentRoute.forEach(location => {
            if (!newLocationsArrivals[location.code]) {
                newLocationsArrivals[location.code] = {}; // Fix: Initialize station code if it doesn’t exist
            }
            if (!newLocationsDepartures[location.code]) {
                newLocationsDepartures[location.code] = {}; // Fix: Initialize station code if it doesn’t exist
            }
            newLocationsArrivals[location.code][train.trainNumber] = { 
                trainNumber: train.trainNumber, 
                hasPassed: location.passed, 
                arrival: location.arrival, 
                departure: location.departure 
            };

            newLocationsDepartures[location.code][train.trainNumber] = {
                trainNumber: train.trainNumber,
                hasPassed: location.passed,
                arrival: location.arrival,
                departure: location.departure
            };
        });
    });
            
    // Sort the trains at each location by arrival time
    Object.keys(newLocationsArrivals).forEach(location => {
        newLocationsArrivals[location] = Object.values(newLocationsArrivals[location]).sort((a, b) => a.arrival - b.arrival);
    });

    // Sort the trains at each location by departure time
    Object.keys(newLocationsDepartures).forEach(location => {
        newLocationsDepartures[location] = Object.values(newLocationsDepartures[location]).sort((a, b) => a.departure - b.departure);
    });

    // Update locations with new data
    Object.keys(locationsArrivals).forEach(key => delete locationsArrivals[key]); // Clear existing data
    Object.assign(locationsArrivals, newLocationsArrivals); // Copy new data into existing object

    Object.keys(locationsDepartures).forEach(key => delete locationsDepartures[key]); // Clear existing data
    Object.assign(locationsDepartures, newLocationsDepartures); // Copy new data into existing object
}

// Every 5 minutes
const fiveMinutesTimer = new CronJob('0 */5 * * * *', updateLocations, null, false, 'Europe/Oslo');
updateLocations();


module.exports = { dayTimer, fiveMinutesTimer, locationsArrivals, locationsDepartures, updateLocations };

