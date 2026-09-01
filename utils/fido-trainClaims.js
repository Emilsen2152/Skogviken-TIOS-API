const mongoose = require('mongoose');
const { Schema } = mongoose;

const fidoTrainClaimsSchema = new Schema({
	trainNumber: {
		type: String,
		required: true,
		unique: true // Ensures no duplicates
	},
	tiosUser: {
		type: String,
		required: true
	}
}, { minimize: false });

module.exports = mongoose.model('fidoTrainClaims', fidoTrainClaimsSchema);
