import '../lib/loadEnv';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddress, isAddress } from 'viem';
import { generateJWT } from '../lib/auth';
import { adminDb } from '../db/client';

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const SLEEP_MS = Number(process.env.A2A_TEST_SLEEP_MS || 20_000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(path: string, body: unknown, wallet: `0x${string}`) {
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
  return { status: res.status, json };
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

function makeCryptoPngDataUrl() {
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

function makeAudioDataUrl() {
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
    throw new Error('TEST_WALLET_ADDRESS missing');
  }
  const wallet = getAddress(raw);
  const sinceIso = new Date(Date.now() - 5_000).toISOString();
  console.log('[media-a2a] wallet=', wallet);
  console.log('[media-a2a] since=', sinceIso);

  const vision = await postJson(
    '/api/dcw/agents/vision/run',
    {
      attachment: makeCryptoPngDataUrl(),
      prompt: 'Analyze this crypto finance chart and decide what research is needed about Arc Network DeFi protocols.',
      requestId: randomUUID(),
    },
    wallet,
  );
  console.log('[media-a2a] vision:', vision.status, JSON.stringify(vision.json).slice(0, 1200));
  await sleep(SLEEP_MS);
  await probe('vision->research', sinceIso);

  const transcribe = await postJson(
    '/api/dcw/agents/transcribe/run',
    {
      audio: makeAudioDataUrl(),
      requestId: randomUUID(),
    },
    wallet,
  );
  console.log('[media-a2a] transcribe:', transcribe.status, JSON.stringify(transcribe.json).slice(0, 1200));
  await sleep(SLEEP_MS);
  await probe('transcribe->research', sinceIso);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
