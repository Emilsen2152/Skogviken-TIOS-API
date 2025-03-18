const CronJob = require('cron').CronJob;
const trains = require('./utils/train');

console.log('Timers are running...');

const locations = {}

// New day
const hourTimer = new CronJob('0 0 0 * * *', async () => {
    const allTrains = await trains.find({});
    allTrains.forEach(train => {
        if (train.extraTrain) {
            train.deleteOne();
        } else {
            train.currentRoute = train.defaultRoute.map(station => {
                const { name, code, type, track, arrival, departure, stopType, passed, cancelledAtStation } = station;
    
                const arrivalTime = new Date();
                arrivalTime.setHours(arrival.hours, arrival.minutes, 0, 0);
    
                const departureTime = new Date();
                departureTime.setHours(departure.hours, departure.minutes, 0, 0);
    
                return {
                    name,
                    code,
                    type,
                    track,
                    arrival: arrivalTime,
                    departure: departureTime,
                    stopType,
                    passed,
                    cancelledAtStation
                };
            });
            train.currentFormation = {};
            train.save();
        }
    });
}, null, false, 'Europe/Oslo');

async function updateLocations() {
    const allTrains = await trains.find({});

    const newLocations = {};
    
    allTrains.forEach(train => {
        train.currentRoute.forEach(location => {
            if (!newLocations[location.code]) {
                newLocations[location.code] = {}; // Fix: Initialize station code if it doesn’t exist
            }
            newLocations[location.code][train.trainNumber] = { 
                trainNumber: train.trainNumber, 
                hasPassed: location.passed, 
                arrival: location.arrival, 
                departure: location.departure 
            };
        });
    });
            
    // Sort the trains at each location by arrival time
    Object.keys(newLocations).forEach(location => {
        newLocations[location] = Object.values(newLocations[location]).sort((a, b) => a.arrival - b.arrival);
    });

    console.log(newLocations); // Fix: Log the correct variable

    // Update locations with new data
    Object.keys(locations).forEach(key => delete locations[key]); // Clear existing data
    Object.assign(locations, newLocations); // Copy new data into existing object
}

// Every 5 minutes
const fiveMinutesTimer = new CronJob('0 */5 * * * *', updateLocations, null, false, 'Europe/Oslo');
updateLocations();


module.exports = { hourTimer, fiveMinutesTimer, locations, updateLocations };

