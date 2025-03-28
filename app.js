require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const { DateTime } = require('luxon');
const trains = require('./utils/train');
const { dayTimer, fiveMinutesTimer, locationsArrivals, locationsDepartures, updateLocations } = require('./timers');
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
    res.status(200).json({ status: 'Running' });
});

// Get Norway's time with API key validation
app.get('/norwayTime', async (req, res) => {
    if (!checkApiKey(req)) return res.status(401).send('Unauthorized');

    const norwayTime = DateTime.now().setZone('Europe/Oslo').toFormat('dd.MM.yyyy HH:mm:ss');
    res.json({ norwayTime });
});

// Get Norway's time with custom format
app.get('/norwayTime/:format', async (req, res) => {
    const { format } = req.params;
    if (!checkApiKey(req)) return res.status(401).send('Unauthorized');

    // Validate format
    const validFormats = ['dd.MM.yyyy HH:mm:ss', 'dd.MM.yyyy HH:mm', 'dd.MM.yyyy', 'HH:mm:ss', 'HH:mm'];
    if (!validFormats.includes(format)) return res.status(400).send('Invalid format');

    const norwayTime = DateTime.now().setZone('Europe/Oslo').toFormat(format);
    res.json({ norwayTime });
});

// Add a new train
app.post('/trains', async (req, res) => {
    if (!checkApiKey(req)) return res.status(401).send('Unauthorized');

    const { trainNumber, operator, defaultRoute, extraTrain, routeNumber } = req.body;
    if (!trainNumber || !operator || !defaultRoute || extraTrain === undefined) {
        return res.status(400).send('Missing required fields');
    }
    if (!Array.isArray(defaultRoute)) return res.status(400).send('defaultRoute must be an array');

    try {
        const validationResult = validateRoute(defaultRoute);
        if (validationResult !== true) return res.status(400).send(validationResult);

        const existingTrain = await trains.findOne({ trainNumber }).exec();
        if (existingTrain) return res.status(409).send('Train number already exists');

        const currentRoute = convertToUTC(defaultRoute);

        const newTrain = new trains({ trainNumber, operator, extraTrain, defaultRoute, currentRoute, routeNumber });
        await newTrain.save();
        res.status(201).json(newTrain);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get specific train by number
app.get('/trains/:trainNumber', async (req, res) => {
    const { trainNumber } = req.params;

    try {
        const train = await trains.findOne({ trainNumber }).exec();
        if (!train) return res.status(404).send('Train not found');
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
        if (!train) return res.status(404).send('Train not found');

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
app.get('/trains', async (req, res) => {
    if (!checkApiKey(req)) return res.status(401).send('Unauthorized');

    const { query } = req.body;
    if (!query || typeof query !== 'object') return res.status(400).send('Invalid query format');

    try {
        const trainsList = await trains.find(query).exec();
        if (!trainsList.length) return res.status(404).send('No trains found');
        res.json(trainsList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update specific train details
app.patch('/trains/:trainNumber', async (req, res) => {
    const { trainNumber } = req.params;
    const updates = req.body;

    if (!checkApiKey(req)) return res.status(401).send('Unauthorized');

    try {
        const updatedTrain = await trains.findOneAndUpdate(
            { trainNumber },
            { $set: updates },
            { new: true, runValidators: true }
        ).exec();

        if (!updatedTrain) return res.status(404).send('Train not found');
        res.status(200).json(updatedTrain);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Apply delay to train
app.patch('/trains/:trainNumber/delay', async (req, res) => {
    const { trainNumber } = req.params;
    const { delay, editStopTimes } = req.body;

    if (!trainNumber || delay === undefined || editStopTimes === undefined) {
        return res.status(400).send('Missing required fields');
    }

    if (!checkApiKey(req)) return res.status(401).send('Unauthorized');

    try {
        const train = await trains.findOne({ trainNumber }).exec();
        if (!train) return res.status(404).send('Train not found');

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
            }
        });

        train.markModified('currentRoute');
        await train.save();
        res.status(200).json(train);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Replace existing train details
app.put('/trains/:trainNumber', async (req, res) => {
    const { trainNumber } = req.params;
    const { operator, defaultRoute, extraTrain, routeNumber } = req.body;

    if (!checkApiKey(req)) return res.status(401).send('Unauthorized');

    if (!operator || !defaultRoute || extraTrain === undefined) {
        return res.status(400).send('Missing required fields');
    }

    if (!Array.isArray(defaultRoute)) return res.status(400).send('defaultRoute must be an array');

    try {
        const validationResult = validateRoute(defaultRoute);
        if (validationResult !== true) return res.status(400).send(validationResult);

        const currentRoute = convertToUTC(defaultRoute);

        const updatedTrain = await trains.findOneAndUpdate(
            { trainNumber },
            { operator, extraTrain, defaultRoute, currentRoute, routeNumber },
            { new: true, upsert: true, runValidators: true }
        ).exec();

        res.status(200).json(updatedTrain);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a train
app.delete('/trains/:trainNumber', async (req, res) => {
    const { trainNumber } = req.params;

    if (!checkApiKey(req)) return res.status(401).send('Unauthorized');

    try {
        const deletedTrain = await trains.findOneAndDelete({ trainNumber }).exec();
        if (!deletedTrain) return res.status(404).send('Train not found');
        res.status(204).send('Successfully deleted');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch arrivals for a station
app.get('/locations/:stationCode/arrivals', (req, res) => {
    const { stationCode } = req.params;

    if (!locationsArrivals[stationCode]) return res.status(404).send('Station not found or no trains');

    res.json(locationsArrivals[stationCode]);
});

// Fetch departures for a station
app.get('/locations/:stationCode/departures', (req, res) => {
    const { stationCode } = req.params;

    if (!locationsDepartures[stationCode]) return res.status(404).send('Station not found or no trains');

    res.json(locationsDepartures[stationCode]);
});

// Force update locations method
app.post('/locations', async (req, res) => {
    if (!checkApiKey(req)) return res.status(401).send('Unauthorized');

    try {
        await updateLocations();
        res.status(200).send('Locations updated');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start timers
dayTimer.start();
fiveMinutesTimer.start();
