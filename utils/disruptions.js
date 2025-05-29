const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const disruptions = new Schema({
    messageName: {
        type: String,
        required: true
    },
    stations: {
        type: Array,
        required: true
    },
    lines : {
        type: Array,
        required: true
    },
    trains: {
        type: Array,
        required: true
    },
    mainMessageAt: {
        type: Array,
        required: true
    },
    disruption: {
        type: Boolean,
        required: true
    },
    internalInfo: {
        type: Object,
        required: true
    },
    NOR: {
        type: Object,
        required: true
    },
    ENG: {
        type: Object,
        required: true
    },
    Start: {
        type: Object,
        required: true
    },
    End: {
        type: Object,
        required: true
    }
}, { minimize: false });

module.exports = mongoose.model('disruptions', disruptions);
