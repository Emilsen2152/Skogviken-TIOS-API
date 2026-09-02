const mongoose = require('mongoose');
const { Schema } = mongoose;

const fidoGsmRNumbersSchema = new Schema({
	GSMRNumber: {
		type: String,
		required: true,
		unique: true // Ensures no duplicates
	},
	tiosUser: {
		type: String,
		required: true
	},
	role: {
		type: String,
		required: true,
		enum: ['conductor', 'driver_trainee', 'driver', 'dispatcher_trainee', 'dispatcher', 'signaller_trainee', 'signaller', 'train_information_trainee', 'train_information', 'coss', 'scheduling_office']
	},
	location: {
		type: String,
		required: false
	}
}, { minimize: false });

module.exports = mongoose.model('fidoGsmRNumbers', fidoGsmRNumbersSchema);
