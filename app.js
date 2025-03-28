require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const { DateTime } = require('luxon');
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
        console.error(`MongoDB Error: ${error.message}`);
    }
})();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

app.get('/status', (req, res) => {
    res.status(200).json({ status: 'Running' });
});

// Middleware to validate API Key
const validateApiKey = (req, res, next) => {
    const { key } = req.headers;
    if (key !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

app.get('/norwayTime', validateApiKey, (req, res) => {
    const norwayTime = DateTime.now().setZone('Europe/Oslo').toFormat('dd.MM.yyyy HH:mm:ss');
    res.json({ norwayTime });
});

app.get('/norwayTime/:format', validateApiKey, (req, res) => {
    const { format } = req.params;
    const validFormats = ['dd.MM.yyyy HH:mm:ss', 'dd.MM.yyyy HH:mm', 'dd.MM.yyyy', 'HH:mm:ss', 'HH:mm'];

    if (!validFormats.includes(format)) {
        return res.status(400).json({ error: 'Invalid format' });
    }

    const norwayTime = DateTime.now().setZone('Europe/Oslo').toFormat(format);
    res.json({ norwayTime });
});

app.post('/trains', validateApiKey, async (req, res) => {
    const { trainNumber, operator, defaultRoute, extraTrain, routeNumber } = req.body;

    if (!trainNumber || !operator || !defaultRoute || extraTrain === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!Array.isArray(defaultRoute)) {
        return res.status(400).json({ error: 'defaultRoute must be an array' });
    }

    try {
        const existingTrain = await trains.findOne({ trainNumber }).exec();
        if (existingTrain) {
            return res.status(409).json({ error: 'Train number already exists' });
        }

        const newTrain = new trains({
            trainNumber,
            operator,
            extraTrain,
            defaultRoute,
            currentRoute: defaultRoute.map(station => ({
                ...station,
                arrival: DateTime.fromObject(
                    { hour: station.arrival.hours, minute: station.arrival.minutes },
                    { zone: 'Europe/Oslo' }
                ).toUTC().toJSDate(),
                departure: DateTime.fromObject(
                    { hour: station.departure.hours, minute: station.departure.minutes },
                    { zone: 'Europe/Oslo' }
                ).toUTC().toJSDate()
            }))
        });

        if (routeNumber) newTrain.routeNumber = routeNumber;

        await newTrain.save();
        res.status(201).json(newTrain);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/trains/:trainNumber', async (req, res) => {
    try {
        const train = await trains.findOne({ trainNumber: req.params.trainNumber }).exec();
        if (!train) {
            return res.status(404).json({ error: 'Train not found' });
        }
        res.json(train);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/trains/:trainNumber/norwayTimeRoute', async (req, res) => {
    try {
        const train = await trains.findOne({ trainNumber: req.params.trainNumber }).exec();
        if (!train) {
            return res.status(404).json({ error: 'Train not found' });
        }

        const norwayTimeRoute = train.currentRoute.map(location => ({
            ...location,
            arrival: DateTime.fromJSDate(location.arrival).setZone('Europe/Oslo').toFormat('dd.MM.yyyy HH:mm'),
            departure: DateTime.fromJSDate(location.departure).setZone('Europe/Oslo').toFormat('dd.MM.yyyy HH:mm')
        }));

        res.json(norwayTimeRoute);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/trains', validateApiKey, async (req, res) => {
    const { query } = req.body;

    if (!query || typeof query !== 'object') {
        return res.status(400).json({ error: 'Query must be a valid object' });
    }

    try {
        const trainsList = await trains.find(query).exec();
        res.json(trainsList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* Valid routedata
    trainNumber: {
        type: String,
        required: true
    },
    operator: {
        type: String,
        required: true
    },
    extraTrain: {   
        type: Boolean,
        required: true
    },
    routeNumber: {
        type: String,
        required: false
    },
    defaultRoute: {
        type: Array,
        required: true
    },
    currentRoute: {
        type: Array,
        required: true
    },
    currentFormation: {
        type: Object,
        default: {}
    },
    position: {
        type: Array, // Array of track areas
        default: []
    }
*/

app.patch('/trains/:trainNumber', validateApiKey, async (req, res) => {
    try {
        const updatedTrain = await trains.findOneAndUpdate(
            { trainNumber: req.params.trainNumber },
            { $set: req.body },
            { new: true, runValidators: true }
        ).exec();

        if (!updatedTrain) {
            return res.status(404).json({ error: 'Train not found' });
        }

        res.json(updatedTrain);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/trains/:trainNumber', validateApiKey, async (req, res) => {
    const { routeData } = req.body;

    // Check if routeData is a valid object
    if (!routeData || typeof routeData !== 'object') {
        return res.status(400).json({ error: 'routeData must be a valid object' });
    }

    // Validate that routeData has the required properties
    const requiredProperties = ['trainNumber', 'operator', 'extraTrain', 'defaultRoute', 'currentRoute', 'currentFormation', 'position'];
    const hasAllProperties = requiredProperties.every(prop => routeData.hasOwnProperty(prop));

    if (!hasAllProperties) {
        return res.status(400).json({ error: 'routeData must contain all required properties' });
    }

    try {
        const updatedTrain = await trains.findOneAndUpdate(
            { trainNumber: req.params.trainNumber },
            { $set: routeData },
            { new: true, upsert: true, runValidators: true }
        ).exec();

        res.json(updatedTrain);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/trains/:trainNumber', validateApiKey, async (req, res) => {
    try {
        const deletedTrain = await trains.findOneAndDelete({ trainNumber: req.params.trainNumber }).exec();
        if (!deletedTrain) {
            return res.status(404).json({ error: 'Train not found' });
        }
        res.status(200).json({ message: 'Successfully deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/locations/:stationCode/arrivals', (req, res) => {
    const arrivals = locationsArrivals[req.params.stationCode];
    if (!arrivals) {
        return res.status(404).json({ error: 'Station not found or no arrivals available' });
    }
    res.json(arrivals);
});

app.get('/locations/:stationCode/departures', (req, res) => {
    const departures = locationsDepartures[req.params.stationCode];
    if (!departures) {
        return res.status(404).json({ error: 'Station not found or no departures available' });
    }
    res.json(departures);
});

app.post('/locations', validateApiKey, async (req, res) => {
    try {
        await updateLocations();
        res.status(200).json({ message: 'Locations updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

dayTimer.start();
fiveMinutesTimer.start();
