const { getLogger } = require('logger');
const config = require('config');
const db = require('db');

const logger = getLogger('Main');
const app = {};

db.initialize(app)
.then(() => {
	const Downloader = require('lib');
	const downloader = new Downloader();
	return downloader.start();
})
.then(() => logger.info(`Downloaded on ${new Date}`), (error) => logger.error(error));
