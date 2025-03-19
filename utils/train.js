const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const trainSchema = new Schema({
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
});

module.exports = mongoose.model('Trains', trainSchema);

/*
defaultRouteExample = [ 0 is the first stop the train makes
    {
        name: String,
        code: String,
        type: String, // stasjon, stoppested, holdeplass, blokkpost, skifteområde, sidespor
        track: Number,
        arrival: {
            hours: Number
            minutes: Number,
        },
        departure: {
            hours: Number
            minutes: Number,
        },
        stopType: String,
        passed: Boolean,
        cancelledAtStation: Boolean
    }
]

currentRouteExample = [
    {
        name: String,
        code: String,
        type: String, // stasjon, stoppested, holdeplass, blokkpost, skifteområde, sidespor
        track: Number,
        arrival: Date,
        departure: Date,
        stopType: String,
        passed: Boolean,
        cancelledAtStation: Boolean
    }
]
*/
