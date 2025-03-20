const CronJob = require('cron').CronJob;
const trains = require('./utils/train');

console.log('Timers are running...');

const locationsArrivals = {};
const locationsDepartures = {};

// New day
const dayTimer = new CronJob('0 0 0 * * *', async () => {
    const allTrains = await trains.find({});
    for (const train of allTrains) {
        if (train.extraTrain) {
            await train.deleteOne();
        } else {
            // Get the current date in Norway
            const now = new Date();
            const localDate = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Oslo" }));

            train.currentRoute = train.defaultRoute.map(station => {
                const { name, code, type, track, arrival, departure, stopType, passed, cancelledAtStation } = station;

                // Create the arrival and departure times in local Norwegian time
                const arrivalTime = new Date(localDate);
                arrivalTime.setHours(arrival.hours, arrival.minutes, 0, 0);

                const departureTime = new Date(localDate);
                departureTime.setHours(departure.hours, departure.minutes, 0, 0);

                // Convert to UTC before storing
                const arrivalUTC = new Date(arrivalTime.getTime() - (arrivalTime.getTimezoneOffset() * 60000));
                const departureUTC = new Date(departureTime.getTime() - (departureTime.getTimezoneOffset() * 60000));

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

