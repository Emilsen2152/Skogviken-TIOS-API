require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const { DateTime } = require('luxon');
const trains = require('./utils/train');
const servers = require('./utils/server');
const { dayTimer, locationUpdateTimer, locationsArrivals, locationsDepartures, locationNames, updateLocations } = require('./timers');
const { checkApiKey, validateRoute, convertToUTC } = require('./utils/helpers'); // Modularized helpers

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 80;

// MongoDB connection
(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to Mongo DB.');
    } catch (error) {
        console.error(`Mongo DB Error: ${error}`);
    }
})();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

// Health check endpoint
app.get('/status', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Get Norway's time with API key validation
app.get('/norwayTime', checkApiKey, async (req, res) => {
    const norwayTime = DateTime.now().setZone('Europe/Oslo').toFormat('dd.MM.yyyy HH:mm:ss');
    res.json({ norwayTime });
});

// Get Norway's time with custom format
app.get('/norwayTime/custom/:format', checkApiKey, async (req, res) => {
    const { format } = req.params;
    const validFormats = ['dd.MM.yyyy HH:mm:ss', 'dd.MM.yyyy HH:mm', 'dd.MM.yyyy', 'HH:mm:ss', 'HH:mm'];
    if (!validFormats.includes(format)) return res.status(400).json({ error: 'Invalid format' });

    const norwayTime = DateTime.now().setZone('Europe/Oslo').toFormat(format);
    res.status(200).json({ norwayTime });
});

app.get('/norwayTime/offset', checkApiKey, async (req, res) => {
    // Get offset from UTC in hours
    const norwayTime = DateTime.now().setZone('Europe/Oslo');
    const offset = norwayTime.offset / 60; // Convert minutes to hours
    res.json({ offset });
});

// Add a new train
app.post('/trains', checkApiKey, async (req, res) => {
    const { trainNumber, operator, defaultRoute, extraTrain, routeNumber, currentFormation } = req.body;

    if (!trainNumber || !operator || !defaultRoute || extraTrain === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!Array.isArray(defaultRoute)) return res.status(400).json({ error: 'defaultRoute must be an array' });

    try {
        const validationResult = validateRoute(defaultRoute);
        if (validationResult !== true) return res.status(400).json({ error: validationResult });

        const existingTrain = await trains.findOne({ trainNumber }).exec();
        if (existingTrain) return res.status(409).json({ error: 'Train number already exists' });

        const currentRoute = convertToUTC(defaultRoute);

        // If currentFormation is missing or undefined, set it to an empty object
        const formationToAdd = currentFormation && typeof currentFormation === 'object' ? currentFormation : {};

        const routeNumberToAdd = routeNumber || '';

        const newTrain = new trains({ 
            trainNumber, 
            operator, 
            extraTrain, 
            routeNumber: routeNumberToAdd, 
            defaultRoute, 
            currentRoute, 
            currentFormation: formationToAdd 
        });

        await newTrain.save();
        res.status(201).json(newTrain);
    } catch (error) {
        console.error('Error saving train:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get specific train by number
app.get('/trains/:trainNumber', async (req, res) => {
    const { trainNumber } = req.params;

    try {
        const train = await trains.findOne({ trainNumber }).exec();
        if (!train) return res.status(404).json({ error: 'Train not found' });
        res.json(train);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get route times for a specific train
app.get('/trains/:trainNumber/norwayTimeRoute', async (req, res) => {
    const { trainNumber } = req.params;

    try {
        const train = await trains.findOne({ trainNumber }).exec();
        if (!train) return res.status(404).json({ error: 'Train not found' });

        const norwayTimeRoute = train.currentRoute.map(location => ({
            name: location.name,
            code: location.code,
            type: location.type,
            track: location.track,
            arrival: DateTime.fromJSDate(location.arrival).setZone('Europe/Oslo').toFormat('dd.MM.yyyy HH:mm'),
            departure: DateTime.fromJSDate(location.departure).setZone('Europe/Oslo').toFormat('dd.MM.yyyy HH:mm'),
            stopType: location.stopType,
            passed: location.passed,
            cancelledAtStation: location.cancelledAtStation
        }));

        res.json(norwayTimeRoute);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch trains based on query
app.get('/trains', checkApiKey, async (req, res) => {
    const { query } = req.body;
    if (!query || typeof query !== 'object') return res.status(400).json({ error: 'Invalid query format' });

    try {
        const trainsList = await trains.find(query).exec();
        if (!trainsList.length) return res.status(404).json({ error: 'No trains found' });
        res.json(trainsList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update specific train details
app.patch('/trains/:trainNumber', checkApiKey, async (req, res) => {
    const { trainNumber } = req.params;
    const updates = req.body;

    // Function to automatically convert string dates to Date objects
    const convertStringDates = (data) => {
        Object.keys(data).forEach(key => {
            const value = data[key];
            // Check if the value is a string that could represent a valid date
            if (typeof value === 'string') {
                const parsedDate = new Date(value);
                if (!isNaN(parsedDate)) { // Valid date
                    data[key] = parsedDate;
                }
            } else if (typeof value === 'object' && value !== null) {
                // Recursively check if the value is an object (to handle nested objects)
                convertStringDates(value);
            }
        });
    };

    // Convert any date fields in updates to Date objects
    convertStringDates(updates);

    try {
        const updatedTrain = await trains.findOneAndUpdate(
            { trainNumber },
            { $set: updates },
            { new: true, runValidators: true }
        ).exec();

        if (!updatedTrain) return res.status(404).json({ error: 'Train not found' });
        res.status(200).json(updatedTrain);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.get('/trains/:trainNumber/route/:locationCode/arrival/delay', async (req, res) => {
    const { trainNumber, locationCode } = req.params;

    const train = await trains.findOne({ trainNumber }).exec();
    if (!train) return res.status(404).json({ error: 'Train not found' });

    const location = train.currentRoute.find(loc => loc.code === locationCode);
    if (!location) return res.status(404).json({ error: 'Location not found in trains current route' });

    if (location.cancelledAtStation) return res.status(400).json({ error: 'Train is cancelled at this station' });

    const defaultLocation = train.defaultRoute.find(loc => loc.code === locationCode);
    if (!defaultLocation) return res.status(404).json({ error: 'Location not found in default route' });

    try {
        const arrival = DateTime.fromJSDate(location.arrival).setZone('Europe/Oslo');
        /*
        Default route arrival time format. In norwegian time zone.

        arrival: {
            hours: Number
            minutes: Number,
        },
        */

        const arrivalHours = defaultLocation.arrival.hours;
        const arrivalMinutes = defaultLocation.arrival.minutes;

        const defaultArrivalTime = DateTime.fromObject({ hour: arrivalHours, minute: arrivalMinutes }, { zone: 'Europe/Oslo' }).toUTC().toJSDate();

        const delay = Math.floor((arrival - defaultArrivalTime) / 60000); // Convert milliseconds to minutes

        res.status(200).json({
            delay
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/trains/:trainNumber/route/:locationCode/departure/delay', async (req, res) => {
    const { trainNumber, locationCode } = req.params;

    const train = await trains.findOne({ trainNumber }).exec();
    if (!train) return res.status(404).json({ error: 'Train not found' });

    const location = train.currentRoute.find(loc => loc.code === locationCode);
    if (!location) return res.status(404).json({ error: 'Location not found in trains current route' });

    if (location.cancelledAtStation) return res.status(400).json({ error: 'Train is cancelled at this station' });

    const defaultLocation = train.defaultRoute.find(loc => loc.code === locationCode);
    if (!defaultLocation) return res.status(404).json({ error: 'Location not found in default route' });

    try {
        const departure = DateTime.fromJSDate(location.departure).setZone('Europe/Oslo');
        /*
        Default route departure time format. In norwegian time zone.

        departure: {
            hours: Number
            minutes: Number,
        },
        */

        const departureHours = defaultLocation.departure.hours;
        const departureMinutes = defaultLocation.departure.minutes;

        const defaultDepartureTime = DateTime.fromObject({ hour: departureHours, minute: departureMinutes }, { zone: 'Europe/Oslo' }).toUTC().toJSDate();

        const delay = Math.floor((departure - defaultDepartureTime) / 60000); // Convert milliseconds to minutes

        res.status(200).json({
            delay
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Apply delay to train
app.patch('/trains/:trainNumber/delay', checkApiKey, async (req, res) => {
    const { trainNumber } = req.params;
    const { delay, editStopTimes } = req.body;

    if (!trainNumber || delay === undefined || editStopTimes === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const train = await trains.findOne({ trainNumber }).exec();
        if (!train) return res.status(404).json({ error: 'Train not found' });

        let delayLeft = delay;
        train.currentRoute.forEach(location => {
            if (!location.passed && !location.cancelledAtStation && delayLeft > 0 && editStopTimes) {
                const { arrival, departure } = location;
                const stopDuration = (departure - arrival) / 60000;

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
            } else if (!location.passed && !location.cancelledAtStation && delayLeft > 0) {
                const { arrival, departure } = location;

                arrival.setMinutes(arrival.getMinutes() + delayLeft);
                departure.setMinutes(departure.getMinutes() + delayLeft);

                location.arrival = arrival;
                location.departure = departure;
            };
        });

        train.markModified('currentRoute');
        await train.save();
        res.status(200).json(train);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cancel a train at a specific location or all locations
app.patch('/trains/:trainNumber/cancel', checkApiKey, async (req, res) => {
    try {
        const { trainNumber } = req.params;
        const { startLocation } = req.body || {};

        const train = await trains.findOne({ trainNumber }).exec();

        if (!train) return res.status(404).json({ error: 'Train not found' });

        if (!startLocation) {
            train.currentRoute.forEach(location => {
                if (!location.passed) {
                    location.cancelledAtStation = true;
                }
            });
        } else {
            const startIndex = train.currentRoute.findIndex(location => location.code === startLocation);
            if (startIndex === -1) return res.status(404).json({ error: 'Location not found in current route' });

            train.currentRoute.forEach((location, index) => {
                if (index >= startIndex) {
                    location.cancelledAtStation = true;
                }
            });
        }

        train.markModified('currentRoute');
        await train.save();
        res.json({ train });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Replace existing train details
app.put('/trains/:trainNumber', checkApiKey, async (req, res) => {
    const { trainData } = req.body;

    // Check if trainData is a valid object
    if (!trainData || typeof trainData !== 'object') {
        return res.status(400).json({ error: 'trainData must be a valid object' });
    }

    // Validate that trainData has the required properties
    const requiredProperties = ['trainNumber', 'operator', 'extraTrain', 'defaultRoute', 'currentRoute', 'currentFormation', 'position'];
    const hasAllProperties = requiredProperties.every(prop => trainData.hasOwnProperty(prop));

    if (!hasAllProperties) {
        return res.status(400).json({ error: 'trainData must contain all required properties' });
    }

    // Function to automatically convert string dates to Date objects
    const convertStringDates = (data) => {
        Object.keys(data).forEach(key => {
            const value = data[key];
            // Check if the value is a string that could represent a valid date
            if (typeof value === 'string') {
                const parsedDate = new Date(value);
                if (!isNaN(parsedDate)) { // Valid date
                    data[key] = parsedDate;
                }
            } else if (typeof value === 'object' && value !== null) {
                // Recursively check if the value is an object (to handle nested objects)
                convertStringDates(value);
            }
        });
    };

    // Convert any date fields in trainData to Date objects
    convertStringDates(trainData);

    try {
        const updatedTrain = await trains.findOneAndUpdate(
            { trainNumber: req.params.trainNumber },
            { $set: trainData },
            { new: true, upsert: true, runValidators: true }
        ).exec();

        res.json(updatedTrain);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a train
app.delete('/trains/:trainNumber', checkApiKey, async (req, res) => {
    const { trainNumber } = req.params;

    try {
        const deletedTrain = await trains.findOneAndDelete({ trainNumber }).exec();
        if (!deletedTrain) return res.status(404).json({ error: 'Train not found' });
        res.status(204).send(); //.json({ message: 'Successfully deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch arrivals for a station
app.get('/locations/:stationCode/arrivals', (req, res) => {
    const { stationCode } = req.params;

    if (!locationsArrivals[stationCode]) return res.status(404).json({ error: 'Station not found or no trains' });

    res.json(locationsArrivals[stationCode]);
});

// Fetch departures for a station
app.get('/locations/:stationCode/departures', (req, res) => {
    const { stationCode } = req.params;

    if (!locationsDepartures[stationCode]) return res.status(404).json({ error: 'Station not found or no trains' });

    res.json(locationsDepartures[stationCode]);
});

// Fetch all locationNames
app.get('/locations', (req, res) => {
    res.status(200).json(locationNames);
});

// Force update locations method
app.post('/locations', checkApiKey, async (req, res) => {
    try {
        await updateLocations();
        res.status(200).json({ message: 'Locations updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/servers', checkApiKey, async (req, res) => {
    const { jobId } = req.body;

    if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

    const existingServer = await servers.findOne({ jobId }).exec();
    if (existingServer) return res.status(409).json({ error: 'Server already exists' });

    try {
        const newServer = new servers({ jobId });
        await newServer.save();
        res.status(201).json(newServer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/servers/:jobId', checkApiKey, async (req, res) => {
    const { jobId } = req.params;
    const { activeRailwayWorkers } = req.body;

    if (!activeRailwayWorkers) return res.status(400).json({ error: 'Missing activeRailwayWorkers' });

    const updatedServer = await servers.findOneAndUpdate(
        { jobId },
        { $set: { activeRailwayWorkers } },
        { new: true, runValidators: true }
    ).exec();

    if (!updatedServer) return res.status(404).json({ error: 'Server not found' });
    res.status(200).json(updatedServer);
});

app.delete('/servers/:jobId', checkApiKey, async (req, res) => {
    const { jobId } = req.params;

    const deletedServer = await servers.findOneAndDelete({ jobId }).exec();
    if (!deletedServer) return res.status(404).json({ error: 'Server not found' });
    res.status(204).send(); //.json({ message: 'Successfully deleted' });
});

// Start timers
dayTimer.start();
locationUpdateTimer.start();
