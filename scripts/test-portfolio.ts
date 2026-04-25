import dotenv from 'dotenv';
import {
  buildPortfolioSnapshot,
  generatePortfolioAssessment,
} from '../agents/portfolio/portfolio';

dotenv.config();

const walletAddress = '0x79FD75a3fC633259aDD60885f927d973d3A3642b';

async function main(): Promise<void> {
  console.log('[test-portfolio] starting');
  console.log(
    JSON.stringify(
      {
        walletAddress,
        alchemyRpcConfigured: Boolean(process.env.ALCHEMY_ARC_RPC),
        hermesDeepModel:
          process.env.HERMES_MODEL_DEEP || process.env.HERMES_MODEL || 'Hermes-4-405B',
      },
      null,
      2,
    ),
  );

  const snapshot = await buildPortfolioSnapshot(walletAddress);
  console.log('[test-portfolio] holdings');
  console.log(JSON.stringify(snapshot.holdings, null, 2));

  console.log('[test-portfolio] positions');
  console.log(JSON.stringify(snapshot.positions, null, 2));

  console.log('[test-portfolio] recent transactions');
  console.log(JSON.stringify(snapshot.recentTransactions, null, 2));

  console.log('[test-portfolio] token transfers');
  console.log(JSON.stringify(snapshot.tokenTransfers, null, 2));

  console.log('[test-portfolio] pnl');
  console.log(JSON.stringify(snapshot.pnlSummary, null, 2));

  console.log('[test-portfolio] diagnostics');
  console.log(JSON.stringify(snapshot.diagnostics, null, 2));

  const assessment = await generatePortfolioAssessment(snapshot, {
    walletAddress,
    agentSlug: 'portfolio',
  });

  console.log('[test-portfolio] hermes assessment');
  console.log(
    JSON.stringify(
      {
        riskScore: assessment.riskScore,
        recommendations: assessment.recommendations,
        notes: assessment.notes,
      },
      null,
      2,
    ),
  );

  console.log('[test-portfolio] report');
  console.log(assessment.report);
}

main().catch((error) => {
  console.error('[test-portfolio] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
