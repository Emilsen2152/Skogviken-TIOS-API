const mongoose = require('mongoose');
const { Schema } = require('mongoose');

// Sub-schema for time objects (hours/minutes)
const timeSchema = new Schema({
    hours: { type: Number, min: 0, max: 23 },
    minutes: { type: Number, min: 0, max: 59 }
}, { _id: false });

// Sub-schema for default route stations
const defaultRouteStopSchema = new Schema({
    name: { type: String, required: true },
    code: { type: String, required: true },
    type: { 
        type: String, 
        enum: ['stasjon', 'stoppested', 'holdeplass', 'blokkpost', 'skifteområde', 'sidespor']
    },
    track: Number,
    arrival: timeSchema,
    departure: timeSchema,
    stopType: String,
    passed: { type: Boolean, default: false },
    cancelledAtStation: { type: Boolean, default: false }
}, { _id: false });

// Sub-schema for live/current route stations
const currentRouteStopSchema = new Schema({
    name: { type: String, required: true },
    code: { type: String, required: true },
    type: { 
        type: String, 
        enum: ['stasjon', 'stoppested', 'holdeplass', 'blokkpost', 'skifteområde', 'sidespor']
    },
    track: Number,
    arrival: Date,
    departure: Date,
    stopType: String,
    passed: { type: Boolean, default: false },
    cancelledAtStation: { type: Boolean, default: false }
}, { _id: false });

// Sub-schema for messages
const messageSchema = new Schema({
    yellow: { type: Boolean, default: false },
    message: {
        NOR: { type: String, required: true },
        ENG: { type: String, required: true }
    },
    from: { type: Date, required: true },
    to: { type: Date, required: true }
}, { _id: false });

// Main Train Schema
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
    defaultRoute: [defaultRouteStopSchema],
    currentRoute: [currentRouteStopSchema],
    currentFormation: {
        type: Object,
        default: {}
    },
    position: [{ type: String }], // Assuming track area codes are strings
    messages: [messageSchema]
}, { minimize: false });

module.exports = mongoose.model('Trains', trainSchema);