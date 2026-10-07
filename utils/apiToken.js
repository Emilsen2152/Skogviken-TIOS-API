const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const apiTokenSchema = new Schema({
    name: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    tokenPrefix: { type: String, required: true },
    permissions: { type: [String], default: [] },
    expiresAt: { type: Date, default: null },
    revoked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null }
});

module.exports = mongoose.model('ApiToken', apiTokenSchema, 'apiTokens');
