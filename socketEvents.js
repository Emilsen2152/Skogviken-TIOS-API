const trains = require('./utils/train');

let io = null;

function setSocketServer(server) {
    io = server;
}

async function emitTrainList() {
    if (!io) return;

    try {
        const trainList = await trains.find({}).exec();
        const payload = trainList || [];
        io.emit('trains:list', payload);
        io.emit('trains:updated', payload);
    } catch (error) {
        console.error('Socket train list update failed:', error);
    }
}

async function emitTrainDetails(trainNumber) {
    if (!io) return;

    try {
        const train = trainNumber ? await trains.findOne({ trainNumber }).exec() : null;
        io.emit('train:details', train || null);
        io.emit('train:updated', { trainNumber, train: train || null });
    } catch (error) {
        console.error('Socket train detail update failed:', error);
    }
}

function emitLocationSnapshot(arrivals = {}, departures = {}, names = {}) {
    if (!io) return;

    io.emit('locations:arrivals', arrivals || {});
    io.emit('locations:departures', departures || {});
    io.emit('locations:updated', {
        arrivals: arrivals || {},
        departures: departures || {},
        names: names || {}
    });
}

module.exports = {
    setSocketServer,
    emitTrainList,
    emitTrainDetails,
    emitLocationSnapshot
};
