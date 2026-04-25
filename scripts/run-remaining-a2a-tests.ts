import '../lib/loadEnv';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddress, isAddress } from 'viem';
import { generateJWT } from '../lib/auth';
import { adminDb } from '../db/client';

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const SLEEP_MS = Number(process.env.A2A_TEST_SLEEP_MS || 18_000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sseSnippet(raw: string, max = 900): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine;
}

async function chatRespond(
  message: string,
  wallet: `0x${string}`,
  executionTarget: 'DCW' | 'EOA',
): Promise<string> {
  const res = await fetch(`${BASE}/api/chat/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': `remaining-a2a-${wallet.toLowerCase()}`,
    },
    body: JSON.stringify({
      message,
      walletAddress: wallet,
      executionTarget,
    }),
  });
  return res.text();
}

async function postJson(
  path: string,
  body: unknown,
  wallet: `0x${string}`,
): Promise<{ status: number; text: string; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${generateJWT(wallet, 'free')}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, text, json };
}

async function probe(label: string, sinceIso: string): Promise<void> {
  const { data, error } = await adminDb
    .from('transactions')
    .select('buyer_agent, seller_agent, amount, remark, created_at')
    .eq('action_type', 'agent_to_agent_payment')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false });

  if (error) {
    console.log(`[probe:${label}] error: ${error.message}`);
    return;
  }
  console.log(`\n--- NEW A2A ROWS after ${label} ---`);
  console.log(JSON.stringify(data ?? [], null, 2));
}

function makeCryptoPngDataUrl(): { name: string; mimeType: string; size: number; dataUrl: string } {
  const out = `${process.cwd()}\\.codex-logs\\a2a-crypto-chart.png`;
  const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 900, 520
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(14, 17, 24))
$fontTitle = New-Object System.Drawing.Font('Arial', 28, [System.Drawing.FontStyle]::Bold)
$font = New-Object System.Drawing.Font('Arial', 18)
$brushWhite = [System.Drawing.Brushes]::White
$brushGold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(242, 202, 80))
$brushGreen = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(52, 211, 153))
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(242, 202, 80), 5)
$g.DrawString('Arc Network DeFi Dashboard', $fontTitle, $brushGold, 50, 45)
$g.DrawString('USDC liquidity: 14 agent wallets funded', $font, $brushWhite, 50, 105)
$g.DrawString('Gateway balance trend for x402 nanopayments', $font, $brushWhite, 50, 145)
$points = @(
  [System.Drawing.Point]::new(80, 390),
  [System.Drawing.Point]::new(220, 330),
  [System.Drawing.Point]::new(360, 350),
  [System.Drawing.Point]::new(500, 255),
  [System.Drawing.Point]::new(640, 220),
  [System.Drawing.Point]::new(780, 165)
)
$g.DrawLines($pen, $points)
foreach ($p in $points) { $g.FillEllipse($brushGreen, $p.X - 8, $p.Y - 8, 16, 16) }
$g.DrawString('Research trigger: compare Arc DeFi protocol liquidity and risk', $font, $brushWhite, 50, 455)
$bmp.Save('${out.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'pipe' });
  const buffer = readFileSync(out);
  return {
    name: 'a2a-crypto-chart.png',
    mimeType: 'image/png',
    size: buffer.length,
    dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
  };
}

function makeAudioDataUrl(): { name: string; mimeType: string; size: number; dataUrl: string } {
  const out = `${process.cwd()}\\.codex-logs\\a2a-arc-defi.wav`;
  const ps = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile('${out.replace(/\\/g, '\\\\')}')
$synth.Speak('Arc Network DeFi protocols are using USDC payments and agent treasury automation.')
$synth.Dispose()
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'pipe' });
  if (!existsSync(out)) {
    throw new Error('Failed to create test audio file');
  }
  const buffer = readFileSync(out);
  return {
    name: 'a2a-arc-defi.wav',
    mimeType: 'audio/wav',
    size: buffer.length,
    dataUrl: `data:audio/wav;base64,${buffer.toString('base64')}`,
  };
}

async function main(): Promise<void> {
  const raw = process.env.TEST_WALLET_ADDRESS?.trim();
  if (!raw || !isAddress(raw)) {
    throw new Error('Set TEST_WALLET_ADDRESS to a valid wallet address.');
  }
  const wallet = getAddress(raw);
  const sinceIso = new Date(Date.now() - 5_000).toISOString();
  console.log('[remaining-a2a] wallet=', wallet);
  console.log('[remaining-a2a] since=', sinceIso);

  console.log('\n[Test1] Vault -> Portfolio preview');
  const vaultPreview = await chatRespond('deposit 1 USDC to vault', wallet, 'DCW');
  console.log('[Test1] preview:', sseSnippet(vaultPreview));
  console.log('[Test1] sending YES');
  const vaultYes = await chatRespond('YES', wallet, 'DCW');
  console.log('[Test1] YES:', sseSnippet(vaultYes));
  await sleep(SLEEP_MS);
  await probe('Test1 vault->portfolio', sinceIso);

  console.log('\n[Test2] Split -> Portfolio preview');
  const splitSession = `wallet-${wallet.toLowerCase()}`;
  const splitPreview = await postJson(
    '/api/split/run',
    {
      sessionId: splitSession,
      recipients: [
        '0x4C37a02d40F3Ce6D4753D5E0622bAF1643DBE65c',
        '0xb82AE74138acdcd2045b66984990EED0559Ec769',
      ],
      totalAmount: '2',
      remark: 'remaining a2a split test',
    },
    wallet,
  );
  console.log('[Test2] preview:', splitPreview.status, JSON.stringify(splitPreview.json));
  const splitConfirmId = splitPreview.json?.confirmId || splitSession;
  const splitConfirm = await postJson(
    `/api/split/confirm/${encodeURIComponent(splitConfirmId)}`,
    {},
    wallet,
  );
  console.log('[Test2] confirm:', splitConfirm.status, JSON.stringify(splitConfirm.json));
  await sleep(SLEEP_MS);
  await probe('Test2 split->portfolio', sinceIso);

  console.log('\n[Test3] Vision -> Research');
  const attachment = makeCryptoPngDataUrl();
  const vision = await postJson(
    '/api/dcw/agents/vision/run',
    {
      attachment,
      prompt: 'Analyze this crypto finance chart and decide what research is needed about Arc Network DeFi protocols.',
      requestId: randomUUID(),
      walletAddress: wallet,
    },
    wallet,
  );
  console.log('[Test3] vision:', vision.status, JSON.stringify(vision.json).slice(0, 1000));
  await sleep(SLEEP_MS);
  await probe('Test3 vision->research', sinceIso);

  console.log('\n[Test4] Transcribe smoke test');
  const audio = makeAudioDataUrl();
  const transcribe = await postJson(
    '/api/dcw/agents/transcribe/run',
    {
      audio,
      requestId: randomUUID(),
      walletAddress: wallet,
    },
    wallet,
  );
  console.log('[Test4] transcribe:', transcribe.status, JSON.stringify(transcribe.json).slice(0, 1000));
  console.log('[Test4] note: transcribe -> research auto-trigger is intentionally disabled.');

  console.log('\n[remaining-a2a] Done.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
