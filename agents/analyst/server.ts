import express from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { callHermes } from '../../lib/hermes';
import { ANALYST_SYSTEM_PROMPT } from '../../lib/agentPrompts';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.ANALYST_AGENT_PORT || 3002);
const HERMES_TIMEOUT_MS = Number(
  process.env.ANALYST_HERMES_TIMEOUT_MS ||
  process.env.ANALYST_AGENT_TIMEOUT_MS ||
  process.env.AGENT_TIMEOUT_MS ||
  80_000,
);
let privateKey = process.env.PRIVATE_KEY?.trim() ?? '';
if (privateKey && !privateKey.startsWith('0x')) privateKey = `0x${privateKey}`;
const account = privateKeyToAccount(privateKey as `0x${string}`);

const price =
  process.env.ANALYST_AGENT_PRICE !== undefined
    ? `$${process.env.ANALYST_AGENT_PRICE}`
    : '$0.003';

const facilitatorUrl = process.env.FACILITATOR_URL || 'http://localhost:3000';
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({
  sellerAddress,
  facilitatorUrl,
});

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

const runHandler = async (req: express.Request, res: express.Response) => {
  try {
    const research =
      (req.body?.research as string) ?? (req.query.research as string) ?? '';
    const result = await withTimeout(
      callHermes(ANALYST_SYSTEM_PROMPT, research),
      HERMES_TIMEOUT_MS,
      `Analyst Hermes timed out after ${HERMES_TIMEOUT_MS / 1000}s`,
    );
    res.json({ research, result });
  } catch (err) {
    console.error('Analyst agent error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('timed out') ? 504 : 500;
    res.status(statusCode).json({ error: 'Analyst agent failed', details: message });
  }
};
app.get('/run', gateway.require(price), runHandler);
app.post('/run', gateway.require(price), runHandler);

app.listen(port, () => {
  console.log(`Analyst agent running on :${port}`);
});

