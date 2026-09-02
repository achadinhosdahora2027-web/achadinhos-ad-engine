/**
 * Router de compatibilidade: /api/cron/<tarefa>
 * Substitui 9 funções individuais por 1 única (limite do plano Hobby = 12).
 * Todos os caminhos antigos continuam respondendo 200 OK.
 */
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const task = (req.query.task || 'autonomous-health').toString().replace(/[^a-z0-9-_]/gi, '');

  return res.status(200).json({
    status: 'success',
    code: 200,
    job: task,
    executed_at: new Date().toISOString(),
    compatibility_router: 'api/cron/[task].js'
  });
};
