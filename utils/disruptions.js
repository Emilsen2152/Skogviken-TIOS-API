const mongoose = require('mongoose');
const { Schema } = mongoose;

const disruptionsSchema = new Schema({
	messageName: {
		type: String,
		required: true,
		unique: true // Ensures no duplicates
	},
	stations: {
		type: [String],
		required: true
	},
	lines: {
		type: [String],
		required: true
	},
	mainMessageAt: {
		type: [String],
		required: true
	},
	disruption: {
		type: Boolean,
		required: true
	},
	internalInfo: {
		from: { type: String, required: true },
		to: { type: String, required: true },
		consequence: { type: String, required: true },
		reason: { type: String, required: true },
		action: { type: String, required: true },
		forecast: { type: String, required: true },
		nextUpdate: { type: Date, required: true }
	},
	NOR: {
		Title: { type: String, required: true },
		Description: { type: String, required: true }
	},
	ENG: {
		Title: { type: String, required: true },
		Description: { type: String, required: true }
	},
	startDate: {
		type: Date,
		required: true
	},
	endDate: {
		type: Date,
		required: true
	}
}, { minimize: false });

module.exports = mongoose.model('disruptions', disruptionsSchema);
