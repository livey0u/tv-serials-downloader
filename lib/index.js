const fs = require('fs');
const path = require('path');
const readline = require('readline');

const google = require('googleapis');
const googleAuth = require('google-auth-library');
const youtubedl = require('youtube-dl');
const moment = require('moment');

const { getLogger } = require('logger');
const { saveDatabase, getCollection } = require('db');
const config = require('config');
const logger = getLogger('Downloader');

const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
const DOWNLOAD_LOCATION = config.downloadLocation;

class Downloader {

  constructor() {

    this.settingsCollection = getCollection('settings', { unique: ['type'] });
    this.serialsCollection = getCollection('serials', { unique: ['videoId'] });
    this.serialsDownloadMetaCollection = getCollection('serials-download-meta', { unique: ['name'] });

  }

  download() {

  }

  fetchRecentReleases() {

    return this.authorize().then((auth) => {

        let serials = config.serials;

        return Promise.all(serials.map((serial) => this.findSerialVideos(auth, serial)));

      }).then((results) => {

        return results.reduce((serialVideos, result) => {
          serialVideos.push.apply(serialVideos, result);
          return serialVideos;
        }, []);

      })
      .then((serialVideos) => {

        let downloadPromises = serialVideos.map((serialVideo) => this.download(serialVideo));

        return Promise.all(downloadPromises);

      }).then(saveDatabase);

  }

  authorize() {

    let credentials = JSON.parse(fs.readFileSync(config.google.clientSecretPath));
    let clientSecret = credentials.installed.client_secret;
    let clientId = credentials.installed.client_id;
    let redirectUrl = credentials.installed.redirect_uris[0];

    let auth = new googleAuth();
    let oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

    return this.getToken()
      .then(null, () => this.getNewToken(oauth2Client))
      .then((token) => {
        oauth2Client.credentials = token;
        return oauth2Client;
      });

  }

  getNewToken(oauth2Client) {

    let authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES
    });

    console.log('Authorize this app by visiting this url: ', authUrl);

    let rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve, reject) => {

      rl.question('Enter the code from that page here: ', (code) => {

        rl.close();

        oauth2Client.getToken(code, (error, token) => {
          if (error) {
            console.log('Error while trying to retrieve access token', error);
            return reject(error);
          }
          this.storeToken(token);
          resolve(token);
        });

      });

    });

  }

  storeToken(token) {

    let tokenSetting = this.settingsCollection.findOne({ type: 'token' });

    if (!tokenSetting) {
      logger.info('Saving', token);
      this.settingsCollection.insert({ type: 'token', token: token });
    } else {
      logger.info('Updating', token);
      this.settingsCollection.updateWhere((setting) => setting.type === 'token', (document) => {
        document.token = token;
        return document;
      });
    }

    return saveDatabase();

  }

  getToken() {

    let tokenSetting = this.settingsCollection.findOne({ type: 'token' });
    logger.info('Token', tokenSetting);
    if (tokenSetting) {
      return Promise.resolve(tokenSetting.token);
    }

    return Promise.reject();

  }

  findSerialVideos(auth, serial) {

    return this.searchYoutube(auth, serial).then((results) => {

      let videos = results.filter((result) => Downloader.isEpisode(result.snippet, serial)).map((result) => {

        return { videoId: result.id.videoId, title: result.snippet.title, channelId: result.snippet.channelId, name: serial.name };

      });

      this.setLastFetchedDate(serial, Date.now());

      return videos.reverse();

    });

  }

  getLastFetchedDate(serial) {

    let serialMeta = this.serialsDownloadMetaCollection.findOne({ name: serial.name });

    return serialMeta ? serialMeta.lastFetched : null;

  }

  setLastFetchedDate(serial, datetime) {

    let serialMeta = this.serialsDownloadMetaCollection.findOne({ name: serial.name });

    if (!serialMeta) {
      this.serialsDownloadMetaCollection.insert({ name: serial.name, lastFetched: datetime });
    } else {
      this.serialsDownloadMetaCollection.updateWhere((serialMeta) => serial.name === serialMeta.name, (document) => {
        document.lastFetched = datetime;
        return document;
      });
    }

    return true;

  }

  searchYoutube(auth, serial) {

    let criteria = {
      channelId: serial.channelId,
      auth: auth
    };

    let options = {};
    let service = google.youtube('v3');
    let lastFetched = this.getLastFetchedDate(serial);

    if (lastFetched) {
      options.publishedAfter = moment(new Date(lastFetched)).format();
    } else {
      options.publishedAfter = moment(new Date()).subtract(config.defaultPublishedAfter, 'days').format();
    }

    options.maxResults = 50;
    options.order = 'date';
    options.part = 'snippet';

    logger.info({message: 'Fetching videos', queryOptions: options});

    let query = { ...criteria, ...options };

    return new Promise((resolve, reject) => {

      let results = [];

      function queryYoutube(options) {

        if (options.pageToken) {
          logger.info(`Fetching page ${options.pageToken}`);
          query.pageToken = options.pageToken;
        }

        service.search.list(query, function(error, response) {

          if (error) {
            return reject(error);
          }

          results.push.apply(results, response.items);
          let totalResults = response.pageInfo.totalResults;

          if (response.nextPageToken) {
            return queryYoutube({ pageToken: response.nextPageToken });
          }

          resolve(results);

        });

      }

      queryYoutube({});

    });

  }

  start() {
    return this.fetchRecentReleases();
  }

  download(serial) {

    serial.inprogress = true;
    serial.completed = false;

    let existing = this.serialsCollection.findOne({ title: serial.title });

    if (existing && existing.completed) {
      logger.info({ message: 'Already downloaded', ...serial});
      return Promise.resolve();
    }

    if (existing && existing.inprogress) {
      // remove file, if already exists
      let videoPath = path.join(path.resolve(__dirname, '../'), `${serial.name}-${serial.videoIndex}.mp4`);
      fs.unlinkSync(videoPath);
      serial.videoIndex = existing.videoIndex;
    } else {
      serial.videoIndex = this.serialsCollection.count({ name: serial.name }) + 1;
      this.serialsCollection.insert(serial);
    }

    logger.info({ message: 'Download started', ...serial });

    return new Promise((resolve, reject) => {

      let onComplete = () => {

        logger.info({ message: 'Download completed', ...serial });

        this.serialsCollection.updateWhere((_serial) => serial.videoId === _serial.videoId, (serial) => {
          serial.inprogress = false;
          serial.completed = true;
          return serial;
        });

        resolve();

      };

      if(config.debug) {
        return onComplete();
      }

      let video = youtubedl(`http://www.youtube.com/watch?v=${serial.videoId}`, ['--format=18'], { cwd: DOWNLOAD_LOCATION });

      video.on('info', function(info) {
        logger.info({ message: `Downloading ${info.size / 1000000}MB`, ...serial });
      });

      let stream = video.pipe(fs.createWriteStream(`${serial.name}-${serial.videoIndex}.mp4`));

      stream.on('error', (error) => {

        logger.error(error);

        reject();

      });

      stream.on('finish', onComplete);

      stream.on('end', onComplete);

    });


  }

  static isEpisode(snippet, serial) {

    let regularExpression = new RegExp(serial.namePattern, 'i');
    let nameMatched = regularExpression.test(snippet.title);

    if (!nameMatched) {
      return false;
    }

    if (/highlight|promo|recap|live/i.test(snippet.title)) {
      return false;
    }

    if (/episode/i.test(snippet.title)) {
      return true;
    }

    return true;

  }

}

module.exports = Downloader;