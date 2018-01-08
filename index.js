const fastify = require('fastify');
const { getLogger } = require('logger');
const config = require('config');
const db = require('db');
const middlewares = require('middlewares');
const routes = require('routes');

const logger = getLogger('Server');
const server = fastify();

db.initialize(server)
.then(() => middlewares.initialize(server))
.then(() => routes.initialize(server))
.then(() => startServer(server))
.then((serverURL) => logger.info(`Server running on ${serverURL}`), (error) => logger.error(error));

function startServer(server) {
	
	return new Promise((resolve, reject) => {

		let serverConfig = config.server;

		server.listen(serverConfig.port, serverConfig.host, (error) => {

			if(error) {
				return reject(error);
			}

			resolve(`http://${serverConfig.host}:${serverConfig.port}`);

		});

	});

}