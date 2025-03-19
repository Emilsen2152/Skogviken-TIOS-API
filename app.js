require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const trains = require('./utils/train');
const { dayTimer, fiveMinutesTimer, locationsArrivals, locationsDepartures, updateLocations } = require('./timers');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 80;

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to Mongo DB.');

    } catch (error) {
        console.log(`Mongo DB Error: ${error}`);
    }      
})();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

app.get('/status', (request, response) => {
    const status = {
        status: 'Running'
    };

    response.status(200).json(status);
});

app.post('/trains', async (request, response) => {
    const { key } = request.headers;
    const { trainNumber, operator, defaultRoute, extraTrain } = request.body;

    if (key !== process.env.API_KEY) {
        return response.status(401).send('Unauthorized');
    }

    if (!trainNumber || !operator || !defaultRoute || extraTrain === undefined) {
        return response.status(400).send('Missing required fields');
    }

    // Ensure defaultRoute is an array
    if (!Array.isArray(defaultRoute)) {
        return response.status(400).send('defaultRoute must be an array');
    }

    try {
        // Validate each station in defaultRoute
        for (const station of defaultRoute) {
            const { name, code, type, track, arrival, departure, stopType, passed, cancelledAtStation } = station;

            if (!name || !code || !type || !track || !arrival || !departure || !stopType || passed === undefined || cancelledAtStation === undefined) {
                return response.status(400).send('Missing required fields in defaultRoute');
            }

            // Ensure arrival and departure have valid time formats (hours and minutes)
            if (typeof arrival.hours !== 'number' || typeof arrival.minutes !== 'number' ||
                typeof departure.hours !== 'number' || typeof departure.minutes !== 'number') {
                return response.status(400).send('Invalid arrival or departure time format');
            }
        }

        // Check if a train with the same number already exists
        const existingTrain = await trains.findOne({ trainNumber });
        if (existingTrain) {
            return response.status(409).send('Train number already exists');
        }

        // Build currentRoute with properly formatted times
        const currentRoute = defaultRoute.map(station => {
            const { name, code, type, track, arrival, departure, stopType, passed, cancelledAtStation } = station;

            const arrivalTime = new Date();
            arrivalTime.setUTCHours(arrival.hours, arrival.minutes, 0, 0);

            const departureTime = new Date();
            departureTime.setUTCHours(departure.hours, departure.minutes, 0, 0);

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

        // Save the new train
        const newTrain = new trains({
            trainNumber,
            operator,
            extraTrain,
            defaultRoute,
            currentRoute
        });

        await newTrain.save();
        response.status(201).json(newTrain);

    } catch (error) {
        response.status(500).json({ error: error.message });
    }
});

app.get('/trains/:trainNumber', async (request, response) => {
    const { trainNumber } = request.params;

    /*if (!trainNumber) {
        return response.status(400).send('Missing trainNumber query parameter');
    }*/

    try {
        const train = await trains.findOne({ trainNumber });

        if (!train) {
            return response.status(404).send('Train not found');
        }

        response.json(train);

    } catch (error) {
        response.status(500).json({ error: error.message });
    }
});

app.patch('/trains/:trainNumber', async (request, response) => {
    const { trainNumber } = request.params;
    const updates = request.body;

    const { key } = request.headers;
    if (key !== process.env.API_KEY) {
        return response.status(401).send('Unauthorized');
    };

    try {
        const updatedTrain = await trains.findOneAndUpdate(
            { trainNumber }, // Find train by number
            { $set: updates }, // Apply only the changes
            { new: true, runValidators: true } // Return updated train and validate changes
        ).exec();
        
        if (!updatedTrain) {
            return response.status(404).send('Train not found');
        };

        response.status(200).json(updatedTrain);

    } catch (error) {
        response.status(500).json({ error: error.message });
    };
});

app.patch('/trains/:trainNumber/delay', async (request, response) => {
    const { trainNumber } = request.params;
    const { delay } = request.body;

    const { key } = request.headers;
    if (key !== process.env.API_KEY) {
        return response.status(401).send('Unauthorized');
    }

    try {
        const train = await trains.findOne({ trainNumber });

        if (!train) {
            return response.status(404).send('Train not found');
        }

        let delayLeft = delay;

        train.currentRoute.forEach(location => {
            if (!location.passed) {
                if (delayLeft > 0) {
                    const arrival = new Date(location.arrival);
                    const departure = new Date(location.departure);
                    const stopDuration = (departure - arrival) / 60000; // Convert to minutes

                    // Minimum stop duration is 1 minute
                    if (stopDuration > 1) {
                        const possibleReduction = stopDuration - 1;
                        const reduction = Math.min(possibleReduction, delayLeft);

                        arrival.setMinutes(arrival.getMinutes() + delayLeft);
                        departure.setMinutes(departure.getMinutes() + delayLeft - reduction);

                        location.arrival = arrival;
                        location.departure = departure;

                        delayLeft -= reduction;
                    } else {
                        arrival.setMinutes(arrival.getMinutes() + delayLeft);
                        departure.setMinutes(departure.getMinutes() + delayLeft);

                        location.arrival = arrival;
                        location.departure = departure;
                    }
                }
            }
        });

        train.markModified('currentRoute');

        await train.save();
        response.status(200).json(train);

    } catch (error) {
        response.status(500).json({ error: error.message });
    }
});

app.delete('/trains/:trainNumber', async (request, response) => {
    const { trainNumber } = request.params;
    const { key } = request.headers;

    if (key !== process.env.API_KEY) {
        return response.status(401).send('Unauthorized');
    };

    try {
        const deletedTrain = await trains.findOneAndDelete({ trainNumber });

        if (!deletedTrain) {
            return response.status(404).send('Train not found');
        };

        response.status(204).send('Successfully deleted');

    } catch (error) {
        response.status(500).json({ error: error.message });
    };
});

app.get('/locations/:stationCode/arrivals', (request, response) => {
    const { stationCode } = request.params;
    
    if (!stationCode) {
        return response.status(400).send('Missing stationCode query parameter');
    }
    
    if (!locationsArrivals[stationCode]) {
        return response.status(404).send('Station not found or no trains going through this station');
    }
    
    response.json(locationsArrivals[stationCode]);
});

app.get('/locations/:stationCode/departures', (request, response) => {
    const { stationCode } = request.params;
    
    if (!stationCode) {
        return response.status(400).send('Missing stationCode query parameter');
    }
    
    if (!locationsDepartures[stationCode]) {
        return response.status(404).send('Station not found or no trains going through this station');
    }
    
    response.json(locationsDepartures[stationCode]);
});

// Force update locations method
app.post('/locations', async (request, response) => {
    const { key } = request.headers;

    if (key !== process.env.API_KEY) {
        return response.status(401).send('Unauthorized');
    };

    try {
        await updateLocations();
        response.status(200).send('Locations updated');
    } catch (error) {
        response.status(500).json({ error: error.message });
    }
});

dayTimer.start();
fiveMinutesTimer.start();
