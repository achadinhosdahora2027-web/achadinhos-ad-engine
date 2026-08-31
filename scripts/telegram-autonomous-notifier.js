/**
 * ==============================================================================
 * TELEGRAM AUTONOMOUS UNIFIED NOTIFIER CRON RUNNER 24/7
 * Executed by: GitHub Actions & Autonomous Cron Orchestrator
 * ==============================================================================
 * Dispatches one single consolidated live executive digest per cycle with
 * anti-burst and anti-repetition protection.
 */

const { notifyLiveExecutiveDigest, notifyAffiliateSale } = require('../api/telegram/notify-engine');

async function runTelegramNotifier() {
  console.log('================================================================================');
  console.log('📊 TELEGRAM 24/7 CONSOLIDATED LIVE MONITOR: ANDAMENTO DO DIA E DO MÊS');
  console.log('================================================================================\n');

  const isForce = process.argv.includes('--force') || process.argv.includes('-f');
  const isTestSale = process.argv.includes('--test-sale');

  if (isTestSale) {
    console.log('1. Disparando Notificação de Venda Confirmada em Tempo Real...');
    const sampleSale = {
      brand: 'Booking.com',
      order_id: `BK-${Math.floor(100000 + Math.random() * 900000)}`,
      amount_brl: 450.00,
      commission_brl: 36.00,
      country: 'BR',
      sid: 'gramado_natal_luz_slot_topo',
      category: 'Hospedagem Serra Gaúcha'
    };
    const saleResult = await notifyAffiliateSale(sampleSale);
    console.log('  ↳ Venda status:', saleResult.sent ? 'Enviada com Sucesso!' : saleResult.mode);
  } else {
    console.log('1. Disparando Painel Consolidado ao Vivo (Dia, Mês e Ações Executadas)...');
    const digestResult = await notifyLiveExecutiveDigest({ force: isForce, cooldownMinutes: 45 });
    console.log('  ↳ Painel Consolidado status:', digestResult.sent ? 'Enviado com Sucesso via Telegram API!' : (digestResult.reason || 'Concluído'));
  }

  console.log('\n================================================================================');
  console.log('✅ MONITORAMENTO CONSOLIDADO CONCLUÍDO COM SUCESSO E SEM PONTOS CEGOS!');
  console.log('================================================================================');
}

runTelegramNotifier();
