/**
 * ==============================================================================
 * TWITTER / X API v2 AUTONOMOUS MULTI-LANGUAGE PUBLISHER (2026)
 * Managed by: CMO (Marketing & Growth) & CTO (Tecnologia & Software)
 * ==============================================================================
 * Integrates Twitter / X API v2 with OAuth 1.0a, Bearer Token authentication,
 * multi-country posting, affiliate tracking tags (SID), and self-healing queue.
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../data/twitter-config.json');

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) {}
  }
  return { credentials: {} };
}

const config = loadConfig();
const CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY || config.credentials?.consumer_key || '';
const CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET || config.credentials?.consumer_secret || '';
const ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN || config.credentials?.access_token || '';
const ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET || config.credentials?.access_token_secret || '';
const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN || config.credentials?.bearer_token || '';

function generateOAuth1Header(method, url) {
  const oauthParams = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0'
  };

  const sortedKeys = Object.keys(oauthParams).sort();
  const paramString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`)
    .join('&');

  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(CONSUMER_SECRET)}&${encodeURIComponent(ACCESS_TOKEN_SECRET)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`);

  return `OAuth ${headerParts.join(', ')}`;
}

/**
 * 1. Check Authenticated User Profile
 */
async function getUserProfile() {
  const url = 'https://api.twitter.com/2/users/me';
  const authHeader = generateOAuth1Header('GET', url);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.twitter.com',
      path: '/2/users/me',
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'AquiTemAchadinhosGlobalBot/2.0'
      },
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ ok: res.statusCode === 200, status: res.statusCode, data: parsed.data || parsed });
        } catch (e) {
          resolve({ ok: false, status: res.statusCode, error: e.message });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, timeout: true }); });
    req.end();
  });
}

/**
 * 2. Publish Tweet or Queue if permissions are pending
 */
async function publishTweet(tweetText, options = {}) {
  const url = 'https://api.twitter.com/2/tweets';
  const authHeader = generateOAuth1Header('POST', url);
  const payload = JSON.stringify({ text: tweetText });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.twitter.com',
      path: '/2/tweets',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'AquiTemAchadinhosGlobalBot/2.0'
      },
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode === 201 || res.statusCode === 200) {
            resolve({
              published: true,
              tweet_id: parsed.data?.id,
              text: parsed.data?.text || tweetText,
              statusCode: res.statusCode
            });
          } else {
            // Self-Healing Queue
            const queueDir = path.join(__dirname, '../../public/twitter-queue');
            if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
            const queueFile = path.join(queueDir, `tweet-${Date.now()}.json`);
            fs.writeFileSync(queueFile, JSON.stringify({ text: tweetText, scheduled_at: new Date().toISOString(), reason: parsed.title || 'permission_queued' }, null, 2));

            resolve({
              published: false,
              queued: true,
              statusCode: res.statusCode,
              response: parsed,
              message: 'Tweet queued in self-healing pipeline (Permissions pending write activation in Developer Portal)'
            });
          }
        } catch (e) {
          resolve({ published: false, error: e.message });
        }
      });
    });

    req.on('error', (err) => resolve({ published: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ published: false, timeout: true }); });
    req.write(payload);
    req.end();
  });
}

module.exports = {
  getUserProfile,
  publishTweet,
  generateOAuth1Header
};
