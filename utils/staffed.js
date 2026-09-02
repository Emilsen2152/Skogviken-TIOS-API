const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const staffedSchema = new Schema({
    stationCode: {
        type: String,
        required: true
    },
    staffingType: {
        type: String,
        required: true
    },
    staffed: {
        type: Boolean,
        required: true
    }
});

module.exports = mongoose.model('Staffed', staffedSchema, 'staffed');
