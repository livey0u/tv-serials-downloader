const pino = require('pino');
const config = require('config');

const logger = pino({level: config.logLevel, app: config.name});

exports.getLogger = function getLogger(module) {
	return logger.child({module: module});
};