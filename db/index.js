const loki = require('lokijs');
const config = require('config');

let dbName = config.loki.dbName;
let database = null;

exports.initialize = function initialize() {

  database = new loki(dbName);

  return new Promise((resolve, reject) => {

    database.loadDatabase({}, function(error) {

      if (error) {
        return reject(error);
      }

      resolve();

    });

  });

};

exports.get = function get() {

  return database;

};

exports.saveDatabase = function saveDatabase() {

  return new Promise((resolve, reject) => {

    database.saveDatabase(dbName, (error) => {

      if (error) {
        return reject(error);
      }
      
      resolve();

    });

  });

};

exports.getCollection = function getCollection(collectionName, options) {
  
  let collection = database.getCollection(collectionName);

  if(collection) {
    return collection;
  }

  return database.addCollection(collectionName, options);

};