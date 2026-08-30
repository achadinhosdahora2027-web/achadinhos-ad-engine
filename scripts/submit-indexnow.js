/**
 * Master Global IndexNow Automation (2026)
 * Broadcasts all updated URLs across 195 countries to IndexNow participating engines:
 * - Microsoft Bing
 * - Yandex (Russia / CIS)
 * - Seznam (Central Europe)
 * - Naver (South Korea)
 */
const https = require('https');

const INDEXNOW_KEY = 'a120ccc82c4e2dbeeda51d4cd6d03284e2909f92f101984a2133e567b748455c';
const KEY_LOCATION_SUFFIX = `/${INDEXNOW_KEY}.txt`;

const SITES = [
  {
    host: 'www.aquitemachadinhos.com.br',
    keyLocation: `https://www.aquitemachadinhos.com.br${KEY_LOCATION_SUFFIX}`,
    urls: [
      'https://www.aquitemachadinhos.com.br/',
      'https://www.aquitemachadinhos.com.br/mundial',
      'https://www.aquitemachadinhos.com.br/radar-mundial',
      'https://www.aquitemachadinhos.com.br/entretenimento',
      'https://www.aquitemachadinhos.com.br/transportes'
    ]
  },
  {
    host: 'nexus-ai-v2.vercel.app',
    keyLocation: `https://nexus-ai-v2.vercel.app${KEY_LOCATION_SUFFIX}`,
    urls: [
      'https://nexus-ai-v2.vercel.app/',
      'https://nexus-ai-v2.vercel.app/mundial',
      'https://nexus-ai-v2.vercel.app/radar-mundial',
      'https://nexus-ai-v2.vercel.app/entertainment'
    ]
  },
  {
    host: 'solvegrid.com.br',
    keyLocation: `https://solvegrid.com.br${KEY_LOCATION_SUFFIX}`,
    urls: [
      'https://solvegrid.com.br/',
      'https://solvegrid.com.br/mundial',
      'https://solvegrid.com.br/radar-mundial',
      'https://solvegrid.com.br/tech-pulse'
    ]
  }
];

const INDEXNOW_ENDPOINTS = [
  'api.indexnow.org',
  'www.bing.com',
  'yandex.com'
];

async function postIndexNow(endpoint, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: endpoint,
      port: 443,
      path: '/indexnow',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Achadinhos-IndexNow-Bot/2026'
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ endpoint, status: res.statusCode, body });
      });
    });

    req.on('error', (err) => {
      resolve({ endpoint, status: 'ERROR', error: err.message });
    });

    req.write(data);
    req.end();
  });
}

async function runIndexNowPipeline() {
  console.log('🚀 Initiating Global IndexNow Submission Pipeline (2026)...');
  
  for (const site of SITES) {
    console.log(`\n📡 Pinging search engines for domain: ${site.host}`);
    const payload = {
      host: site.host,
      key: INDEXNOW_KEY,
      keyLocation: site.keyLocation,
      urlList: site.urls
    };

    for (const ep of INDEXNOW_ENDPOINTS) {
      try {
        const res = await postIndexNow(ep, payload);
        console.log(`  [${ep}] ➔ HTTP Status: ${res.status}`);
      } catch (e) {
        console.error(`  [${ep}] ➔ Exception: ${e.message}`);
      }
    }
  }
  console.log('\n✅ IndexNow Global Pipeline Completed successfully!');
}

if (require.main === module) {
  runIndexNowPipeline();
}

module.exports = { runIndexNowPipeline };
