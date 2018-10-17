/* Node modules */
const net = require('net');

/* NPM modules */
const { MongoClient } = require('mongodb');
const redis = require('redis');

/**
 * Checks if a port is opened on the provided host, using a simple TCP check
 * @param host {string}
 * @param port {Number}
**/
function checkPort(host, port) {
  return new Promise((resolve) => { // eslint-disable-line no-undef

    console.debug('Checking ', host, port);

    const client = net.connect({ host, port }, () => resolve(true))
      // here we don't need to reject the promise because all error will resolve it to false (not opened)
      .on('error', () => resolve(false))
      .setTimeout(1000, () => resolve(false));

    client.end();
  });
}

/**
 * Check if MongoDB is opened to login and secured with auth
 * @param host {string}
 * @param port {Number}
 */
function checkMongoDB(host, port) {
  return new Promise((resolve) => { // eslint-disable-line no-undef
    MongoClient.connect(`mongodb://${host}:${port}/local`, {}, (err, db) => {
      if (err) {
        // if an error is raised here it means Mongo was not even able to connect (not auth related)
        // so we suspect port is used by another software (protocol error)
        return resolve({ protocol: false, secured: false });
      }

      // connected, trying a command just to see if auth is enabled
      // and leaving a message in the DB because we want ot help the DBA 
      // for more discreet we could just use .find
      return db.collection('secureit')
        .insert({ msg: 'This server was not secured.', createdAt: new Date() })
        .then(() => {
          resolve({ protocol: true, secured: false });
        })
        .catch(() => {
          // if it catches here it assume that it is an auth error (if connected and can't send command)
          resolve({ protocol: true, secured: true });
        });
    });
  });
}

/**
 * Check if Redis is opened and secured with auth
 * @param host {string}
 * @param port {Number}
 */
function checkRedis(host, port) {
  return new Promise((resolve) => { // eslint-disable-line no-undef
    const redisClient = redis.createClient({ host, port, connect_timeout: 1000 })
      .on('error', () => {
        // @TODO: improve protocol detection 
        // if there is an error connecting we assume redis is secured, but port may be used by another software
        // so the protocol: true here may be innacurate
        resolve({ protocol: true, secured: true });
      })
      .on('connect', () => {
        redisClient.quit();
        // with redis auth is done when connecting. if we are connected without password it means it is not secured
        resolve({ protocol: true, secured: false });
      });
  });
}

/**
* @param context {WebtaskContext}
*/
module.exports = async function main(context, cb) {
  if (!context.query.host) {
    return cb(400, new Error('Bad Request'));
  }

  const [isMongoPortOpen, isRedisPortOpen] = await Promise.all( // eslint-disable-line no-undef
    [checkPort(context.query.host, 27017), checkPort(context.query.host, 6379)]
  );

  console.debug({ isMongoPortOpen, isRedisPortOpen });

  const mongoStatus = { port: isMongoPortOpen, protocol: false, secured: false };
  const redisStatus = { port: isRedisPortOpen, protocol: false, secured: false };

  // @TODO: make both mongoDB / redis check parallel
  if (isMongoPortOpen) {
    const mongoCheck = await checkMongoDB(context.query.host, 27017);
    mongoStatus.protocol = mongoCheck.protocol;
    mongoStatus.secured = mongoCheck.secured;
  }

  if (isRedisPortOpen) {
    const redisCheck = await checkRedis(context.query.host, 6379);
    redisStatus.protocol = redisCheck.protocol;
    redisStatus.secured = redisCheck.secured;
  }

  console.debug({ mongoStatus, redisStatus });

  return cb(null, [{ service: 'MongoDB', status: mongoStatus }, { service: 'Redis', status: redisStatus }]);
}
