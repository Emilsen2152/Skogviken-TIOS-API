const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const serverSchema = new Schema({
    jobId: {
        type: String,
        required: true
    },
    activeRailwayWorkers: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model('Servers', serverSchema);
