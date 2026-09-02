/**
 * ==============================================================================
 * MASTER AFFILIATE DISTRIBUTION & ORCHESTRATION RUNNER (2026)
 * ==============================================================================
 */

const { runAffiliateDistributionOrchestrator } = require('../lib/orchestrator/affiliate-distribution-orchestrator');

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  await runAffiliateDistributionOrchestrator({ dryRun: isDryRun });
}

main();
