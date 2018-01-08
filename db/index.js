const { MongoClient } = require('mongodb');
const config = require('config');

let database = null;

exports.initialize = function initialize() {

  return new Promise((resolve, reject) => {

    MongoClient.connect(config.mongodb.url, function(error, db) {

      if (error) {
        return reject(error);
      }

      database = db;

      resolve(database);

    });

  });

};

exports.get = function get() {

	return database;

};