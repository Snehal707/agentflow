import { Router } from 'express';
import {
  getAgentEconomyLedgerSummary,
  listAgentEconomyLedger,
} from '../lib/agent-economy-ledger';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const agentRaw = String(req.query.agent ?? '').trim().toLowerCase();
    if (agentRaw && !/^[a-z0-9_-]{1,64}$/.test(agentRaw)) {
      return res.status(400).json({ error: 'Invalid agent filter' });
    }
    const agent = agentRaw || undefined;
    const [rows, summary] = await Promise.all([
      listAgentEconomyLedger({ limit, agent }),
      getAgentEconomyLedgerSummary(),
    ]);

    return res.json({ rows, summary });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'agent economy ledger failed',
    });
  }
});

export default router;
