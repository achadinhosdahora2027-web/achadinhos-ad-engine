/**
 * Compatibilidade: a Vercel disparava /api/cron-autopilot no projeto aquitemachadinhos,
 * que NAO serve funcoes /api (retornava 404 em toda execucao diaria das 03:00).
 * Este wrapper garante que o cron diario da Vercel execute o job "master" real.
 */
module.exports = async (req, res) => {
  req.query = { ...(req.query || {}), job: 'master' };
  const secret = process.env.CRON_SECRET || '';
  if (secret) req.headers = { ...(req.headers || {}), authorization: `Bearer ${secret}` };
  return require('./cron/index.js')(req, res);
};
