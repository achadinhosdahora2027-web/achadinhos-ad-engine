/**
 * ==============================================================================
 * MASTER AFFILIATE DISTRIBUTION & ORCHESTRATION RUNNER (2026)
 * ==============================================================================
 */

const { runAffiliateDistributionOrchestrator } = require('../api/orchestrator/affiliate-distribution-orchestrator');

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  await runAffiliateDistributionOrchestrator({ dryRun: isDryRun });
}

main();
