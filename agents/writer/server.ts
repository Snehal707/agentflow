import express from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { callHermes } from '../../lib/hermes';
import { WRITER_SYSTEM_PROMPT } from '../../lib/agentPrompts';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.WRITER_AGENT_PORT || 3003);
const HERMES_TIMEOUT_MS = Number(
  process.env.WRITER_HERMES_TIMEOUT_MS ||
  process.env.WRITER_AGENT_TIMEOUT_MS ||
  process.env.AGENT_TIMEOUT_MS ||
  80_000,
);
let privateKey = process.env.PRIVATE_KEY?.trim() ?? '';
if (privateKey && !privateKey.startsWith('0x')) privateKey = `0x${privateKey}`;
const account = privateKeyToAccount(privateKey as `0x${string}`);

const price =
  process.env.WRITER_AGENT_PRICE !== undefined
    ? `$${process.env.WRITER_AGENT_PRICE}`
    : '$0.008';

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
    const analysis =
      (req.body?.analysis as string) ?? (req.query.analysis as string) ?? '';
    const task = (req.body?.task as string) ?? (req.query.task as string) ?? '';

    const combinedInput = task
      ? `TOPIC:\n${task}\n\nRESEARCH:\n${research}\n\nANALYSIS:\n${analysis}`
      : `RESEARCH:\n${research}\n\nANALYSIS:\n${analysis}`;

    const result = await withTimeout(
      callHermes(WRITER_SYSTEM_PROMPT, combinedInput),
      HERMES_TIMEOUT_MS,
      `Writer Hermes timed out after ${HERMES_TIMEOUT_MS / 1000}s`,
    );
    res.json({ research, analysis, result });
  } catch (err) {
    console.error('Writer agent error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('timed out') ? 504 : 500;
    res.status(statusCode).json({ error: 'Writer agent failed', details: message });
  }
};

app.get('/run', gateway.require(price), runHandler);
app.post('/run', gateway.require(price), runHandler);

app.listen(port, () => {
  console.log(`Writer agent running on :${port}`);
});
