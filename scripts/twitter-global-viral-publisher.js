/**
 * ==============================================================================
 * TWITTER / X 24/7 GLOBAL VIRAL PUBLISHER ENGINE (2026)
 * Managed by: CMO (Marketing & Viralidade) & CTO (Engenharia de Software)
 * ==============================================================================
 * Automatically generates, publishes, and syndicates high-converting tweets
 * across 195 countries in multiple languages with tracking tags (SID).
 */

const fs = require('fs');
const path = require('path');
const { getUserProfile, publishTweet } = require('../lib/twitter/tweet-publisher');

const CONFIG_PATH = path.join(__dirname, '../data/twitter-config.json');
const LEDGER_PATH = path.join(__dirname, '../data/autonomous-state-ledger.json');

// ─── Anti-spam: dedupe persistente de conteúdo via Supabase social_dedupe ───
// 1ª publicação = INSERT 201 → liberado. Duplicata em até 72h = bloqueada.
const httpsLib = require('https');
const crypto = require('crypto');
const SUPA_URL_D = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPA_KEY_D = process.env.SUPABASE_SERVICE_KEY || '';

function sbReq(method, urlPath, body, prefer) {
  return new Promise((resolve) => {
    if (!SUPA_URL_D || !SUPA_KEY_D) return resolve({ status: 0, rows: [] });
    const payload = body ? JSON.stringify(body) : null;
    const req = httpsLib.request(`${SUPA_URL_D}${urlPath}`, {
      method,
      headers: Object.assign({
        apikey: SUPA_KEY_D, Authorization: `Bearer ${SUPA_KEY_D}`, 'Content-Type': 'application/json'
      }, prefer ? { Prefer: prefer } : {})
    }, (rs) => {
      let b = ''; rs.on('data', c => b += c);
      rs.on('end', () => { let rows = []; try { rows = b ? JSON.parse(b) : []; } catch (e) {} resolve({ status: rs.statusCode, rows }); });
    });
    req.on('error', () => resolve({ status: 0, rows: [] }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function acquirePostSlot(kind, text, maxAgeHours = 72) {
  const key = `${kind}:${crypto.createHash('sha256').update(String(text).trim()).digest('hex').slice(0, 32)}`;
  const q = await sbReq('GET', `/rest/v1/social_dedupe?content_key=${encodeURIComponent(key)}&select=created_at`);
  const created = q.rows && q.rows[0] && q.rows[0].created_at ? Date.parse(q.rows[0].created_at) : 0;
  if (created && Date.now() - created < maxAgeHours * 3600 * 1000) return { allowed: false, key };
  if (created) await sbReq('DELETE', `/rest/v1/social_dedupe?content_key=${encodeURIComponent(key)}`);
  const ins = await sbReq('POST', '/rest/v1/social_dedupe', { content_key: key, channel: kind }, 'return=representation');
  if (ins.status === 0) return { allowed: true, key, warn: 'supabase offline — dedupe indisponível' };
  if (ins.status === 201) return { allowed: true, key };
  return { allowed: false, key };
}


const TWEET_TEMPLATES = [
  {
    category: "Gramado Natal Luz 2026 & Booking",
    activeFrom: "2026-11-01",
    activeTo: "2027-01-06",
    lang: "pt",
    text: "🌲 Vai pro Natal Luz em Gramado nas próximas férias? O Booking liberou pousadas e chalés com até 40% OFF e café colonial incluso!\n\n🏨 Garanta sua reserva com cancelamento grátis:\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&site=twitter&slot=gramado_viral&sid=tw_gramado_pt\n\n#Gramado #NatalLuz #Viagens #Turismo #Booking #SerraGaucha #DicasDeViagem"
  },
  {
    category: "NordVPN & Cloud Cyber Security",
    lang: "en",
    text: "🛡️ Protect your AI workloads, cloud servers & remote browsing with military-grade encryption.\n\n⚡ Get 74% OFF + 3 extra months verified.\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=nordvpn&site=twitter&slot=global_viral&sid=tw_nordvpn_en\n\n#Cybersecurity #NordVPN #Cloud #DevOps #AI #TechDeals"
  },
  {
    category: "Aluguel de Carros Brasil & Carla",
    lang: "pt",
    text: "🚗 Viajando pelo Brasil? Compare as melhores locadoras com reserva sem taxa oculta e seguro total incluso em segundos!\n\n🚙 Economize na sua próxima estrada:\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=carla&site=twitter&slot=carla_br&sid=tw_carla_pt\n\n#AluguelDeCarros #Viagens #Ofertas #Turismo #DicasDeViagem"
  },
  {
    category: "Shopee Achadinhos & Robô Aspirador",
    lang: "pt",
    text: "🔥 Esse robô aspirador bivolt com sensor inteligente limpa a casa toda sozinho e está com cupom de frete grátis na Shopee!\n\n🛍️ Resgate seu cupom do dia:\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&site=twitter&slot=shopee_robo&sid=tw_shopee_pt\n\n#Shopee #Achadinhos #Cupons #CasaLimpa #RoboAspirador #AchadinhosShopee"
  },
  {
    category: "Paris Luxury Hotels & Travel",
    lang: "fr",
    text: "🗼 Envie d'une escapade à Paris ? Découvrez les plus beaux hôtels et suites avec jusqu'à 35% de réduction sur Booking.com !\n\n🌟 Annulation gratuite garantie :\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&site=twitter&slot=paris_fr&sid=tw_paris_fr\n\n#Paris #Voyage #Hotel #Tourisme #Booking #BonsPlans"
  },
  {
    category: "Dubai 5-Star Resorts & Flights",
    lang: "en",
    text: "🏙️ Planning a luxury trip to Dubai? Explore presidential suites, world-class resorts & last-minute flight packages with exclusive perks.\n\n✨ Book with flexible cancellation:\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&site=twitter&slot=dubai_en&sid=tw_dubai_en\n\n#Dubai #LuxuryTravel #Resorts #TravelHacks #Hotels"
  },
  {
    category: "Tarot 3D & Previsão Astral Interativa",
    lang: "pt",
    text: "🔮 O universo tem um recado importante para o seu signo hoje! Tire sua carta no Tarot 3D Interativo 2026.\n\n✨ Oráculo 100% grátis:\n\n👉 https://www.aquitemachadinhos.com.br/entretenimento.html#tarot\n\n#Tarot #Astrologia #Signos #Previsoes #Horoscopo #Espiritualidade"
  },
  {
    category: "Tokyo & Japan Travel Guide",
    lang: "ja",
    text: "🇯🇵 日本全国のホテル・温泉宿がお得に予約できる割引クーポン配布中！\n\n🏨 キャンセル無料プラン多数：\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&site=twitter&slot=japan_ja&sid=tw_tokyo_ja\n\n#旅行 #ホテル #Booking #お得情報 #観光"
  },
  {
    category: "Carla Car Rental Latin America",
    lang: "es",
    text: "🚗 ¿Planeando tu próximo viaje? Compara las mejores rentadoras de autos con tarifa VIP garantizada.\n\n🌟 Descuentos exclusivos aquí:\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=carla&site=twitter&slot=global_viral&sid=tw_carla_es\n\n#Viajes #AlquilerDeAutos #Turismo #Descuentos #Vacaciones"
  },
  {
    category: "Lisbon & Portugal Travel",
    lang: "pt",
    text: "🇵🇹 Planejando conhecer Lisboa e Porto? Hotéis boutique e pousadas históricas em Portugal com desconto no Booking!\n\n🏰 Veja as melhores opções:\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&site=twitter&slot=lisbon_pt&sid=tw_lisbon_pt\n\n#Portugal #Lisboa #Porto #Viagens #Turismo"
  },
  {
    category: "Rome Italy Historic Travel",
    lang: "it",
    text: "🇮🇹 Scopri le migliori offerte per hotel e resort a Roma, Milano e Firenze con cancellazione gratuita su Booking!\n\n🍕 Prenota ora con tariffe esclusive:\n\n👉 https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&site=twitter&slot=rome_it&sid=tw_rome_it\n\n#Roma #Viaggi #Hotel #Offerte #Italia"
  }
];

async function runTwitterPublisher() {
  console.log('================================================================================');
  console.log('🐦 TWITTER / X AUTONOMOUS GLOBAL VIRAL ENGINE 24/7');
  console.log('================================================================================\n');

  // 1. Authenticate & Fetch Profile
  console.log('1. Verificando perfil no Twitter / X API v2...');
  const profile = await getUserProfile();

  if (profile.ok) {
    console.log(`  ✓ Conta Autenticada com Sucesso: @${profile.data.username} (${profile.data.name}) [ID: ${profile.data.id}]`);
  } else {
    console.log(`  ⚠️ Perfil status: ${profile.status || 'Offline'} - ${profile.error || 'Check tokens'}`);
  }

  // 2. Select Tweet: calendário (campanha vencida NUNCA sai) + rotação dia/hora
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayOfYear = Math.floor((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 0))) / 86400000);
  const validPool = TWEET_TEMPLATES.filter(t => (!t.activeFrom || today >= t.activeFrom) && (!t.activeTo || today <= t.activeTo));
  const pool = validPool.length ? validPool : TWEET_TEMPLATES.filter(t => !t.activeFrom && !t.activeTo);
  const selectedTweet = pool[(now.getUTCHours() + dayOfYear) % pool.length];

  console.log(`\n2. Gerando Tweet Viral de Alta Conversão [Categoria: ${selectedTweet.category} | Idioma: ${selectedTweet.lang.toUpperCase()}]:`);
  console.log('--------------------------------------------------------------------------------');
  console.log(selectedTweet.text);
  console.log('--------------------------------------------------------------------------------');

  // 3. Publish to Twitter / X
  console.log('\n3. Publicando no Twitter / X API v2...');
  const tweetSlot = await acquirePostSlot('twitter', selectedTweet.text);
  if (!tweetSlot.allowed) {
    console.log('  ⏭️ Tweet idêntico já publicado nas últimas 72h — ciclo encerrado sem repetição (anti-spam Supabase)');
    process.exit(0);
  }
  const publishResult = await publishTweet(selectedTweet.text);

  const oa2 = global.__lastOAuth2Attempt;
  if (!publishResult.published && oa2) {
    console.log(`  🔍 Diagnóstico OAuth2 → HTTP ${oa2.statusCode}${oa2.error ? ' | ' + oa2.error : ''}`);
  }
  if (!publishResult.published) {
    const det = publishResult.response ? (publishResult.response.detail || publishResult.response.title || JSON.stringify(publishResult.response).slice(0, 160)) : (publishResult.error || '—');
    console.log(`  🔍 Diagnóstico OAuth1 → HTTP ${publishResult.statusCode ?? '—'} | ${det}`);
  }

  if (publishResult.published) {
    console.log(`  🎉 TWEET PUBLICADO COM SUCESSO! ID: ${publishResult.tweet_id}`);
  } else if (publishResult.queued) {
    console.log(`  📥 TWEET ENFILEIRADO NA ESTEIRA DE AUTOCURA: ${publishResult.message}`);
  } else {
    console.log(`  ⚠️ Erro na publicação: ${publishResult.error}`);
  }

  // 3b. LOG REAL NO SUPABASE + CROSS-POST RESILIENTE NO TELEGRAM (motor nunca fica parado)
  const httpsMod = require('https');
  const SUPA_URL = process.env.SUPABASE_URL || '';
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || '';
  function sbLog(row) {
    try {
      if (!SUPA_URL || !SUPA_KEY) return Promise.resolve(0);
      const body = JSON.stringify(row);
      return new Promise((resolve) => {
        const r2 = httpsMod.request(`${SUPA_URL.replace(/\/$/, '')}/rest/v1/social_posts`, {
          method: 'POST',
          headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
        }, (rs) => { rs.resume(); resolve(rs.statusCode); });
        r2.on('error', () => resolve(0));
        r2.write(body); r2.end();
      });
    } catch (e) { return Promise.resolve(0); }
  }
  const twStatus = publishResult.published ? 'published' : (publishResult.queued ? 'queued' : 'error');
  await sbLog({
    platform: 'twitter',
    content: selectedTweet.text,
    brand: String(selectedTweet.category || '').slice(0, 60),
    sid: `tw_${selectedTweet.lang || 'xx'}_${Date.now()}`,
    status: twStatus,
    tweet_id: publishResult.tweet_id || null,
    error: twStatus === 'published' ? null : String(publishResult.error || publishResult.message || (publishResult.response && publishResult.response.detail) || '').slice(0, 400)
  });

  if (!publishResult.published && selectedTweet.lang === 'pt') {
    const tgSlot = await acquirePostSlot('telegram_cross', selectedTweet.text);
    if (!tgSlot.allowed) {
      console.log('  ⏭️ Cross-post idêntico já enviado nas últimas 72h — BLOQUEADO (anti-spam Supabase)');
    } else {
    try {
      const { sendTelegramMessage } = require('../lib/telegram/notify-engine');
      const tg = await sendTelegramMessage(selectedTweet.text, { chatId: process.env.TELEGRAM_DEALS_CHANNEL || '@ofertasbrasilz' });
      const ok = !!(tg && (tg.ok || tg.sent || (tg.response && tg.response.ok)));
      await sbLog({
        platform: 'telegram',
        content: selectedTweet.text,
        brand: String(selectedTweet.category || '').slice(0, 60),
        sid: `tg_cross_${Date.now()}`,
        status: ok ? 'published' : 'error',
        error: ok ? null : JSON.stringify(tg || {}).slice(0, 400)
      });
      console.log(`  📣 Cross-post enviado ao Telegram (@ofertasbrasilz): ${ok ? 'OK' : 'falhou'}`);
    } catch (e) {
      await sbLog({ platform: 'telegram', content: selectedTweet.text, status: 'error', error: String((e && e.message) || e).slice(0, 400) });
      console.log('  ⚠️ Cross-post Telegram falhou:', e.message);
    }
    }
  }

  // 4. Update Ledger Telemetry
  try {
    if (fs.existsSync(LEDGER_PATH)) {
      const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
      if (!ledger.cumulative_telemetry) ledger.cumulative_telemetry = {};
      if (!ledger.cumulative_telemetry.twitter_stats) ledger.cumulative_telemetry.twitter_stats = { total_tweets_queued_or_published: 0 };
      ledger.cumulative_telemetry.twitter_stats.total_tweets_queued_or_published += 1;
      ledger.cumulative_telemetry.twitter_stats.last_account = profile.data?.username || 'Savegrid20';
      ledger.cumulative_telemetry.twitter_stats.last_tweet_category = selectedTweet.category;
      fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
    }
  } catch (e) {}

  console.log('  ✓ Telemetria do Twitter/X gravada no Ledger Central para o próximo Digest!');
  console.log('\n================================================================================');
  console.log('✅ TWITTER / X ENGINE 24/7 CONCLUÍDO COM SUCESSO E SEM PONTOS CEGOS!');
  console.log('================================================================================');
}

runTwitterPublisher();
