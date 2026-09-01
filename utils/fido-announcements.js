const mongoose = require('mongoose');
const { Schema } = mongoose;

const fidoAnnouncementsSchema = new Schema({
	announcementName: {
		type: String,
		required: true,
		unique: true // Ensures no duplicates
	},
	stations: {
		type: [String],
		required: true
	},
	announcement: {
		type: String,
		required: true
	},
	startDate: {
		type: Date,
		required: true
	},
	endDate: {
		type: Date,
		required: true
	},
	signedBy: {
		type: [String],
		required: true
	}
}, { minimize: false });

module.exports = mongoose.model('fidoAnnouncements', fidoAnnouncementsSchema);
