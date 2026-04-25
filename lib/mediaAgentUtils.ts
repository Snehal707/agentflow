import { callHermesFast } from './hermes';

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 1 * 1024 * 1024;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CONTEXT_CHARS = 12_000;
const DEFAULT_HERMES_VISION_MODEL =
  process.env.HERMES_VISION_MODEL?.trim() || 'google/gemma-4-26b-a4b-it';
const DEFAULT_OPENAI_FILE_MODEL =
  process.env.OPENAI_FILE_EXTRACTION_MODEL?.trim() || 'gpt-4.1-mini';
const DEFAULT_OPENAI_TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-mini-transcribe';
const DEFAULT_OPENAI_TRANSCRIPTION_FALLBACK_MODEL =
  process.env.OPENAI_TRANSCRIPTION_FALLBACK_MODEL?.trim() || 'whisper-1';
const DEFAULT_OPENAI_TRANSCRIPTION_LANGUAGE =
  process.env.OPENAI_TRANSCRIPTION_LANGUAGE?.trim() || 'en';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'log']);
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);
const TEXT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/ld+json',
]);
const AUDIO_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/m4a',
]);

export type VisionAttachmentKind = 'image' | 'pdf' | 'text';

export type VisionAttachmentPayload = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

export type PreparedVisionAttachment = {
  kind: VisionAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
};

export type VisionAnalysisResult = {
  answer: string;
  sourceType: VisionAttachmentKind;
  extractor: 'hermes' | 'hermes-text' | 'openai-fallback';
  notes: string[];
};

export type AudioPayload = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

export type PreparedAudioPayload = {
  name: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
};

type ParsedDataUrl = {
  mimeType: string;
  buffer: Buffer;
};

type OpenAiResponsesOutput = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

function resolveOpenAiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

function getExtension(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : '';
}

function normalizeMimeType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() || '';
}

function isImageLike(name: string, mimeType: string): boolean {
  return IMAGE_TYPES.has(normalizeMimeType(mimeType)) || IMAGE_EXTENSIONS.has(getExtension(name));
}

function isTextLike(name: string, mimeType: string): boolean {
  return TEXT_TYPES.has(normalizeMimeType(mimeType)) || TEXT_EXTENSIONS.has(getExtension(name));
}

function isPdfLike(name: string, mimeType: string): boolean {
  return normalizeMimeType(mimeType) === 'application/pdf' || getExtension(name) === 'pdf';
}

function isAudioLike(name: string, mimeType: string): boolean {
  const extension = getExtension(name);
  return AUDIO_TYPES.has(normalizeMimeType(mimeType)) || ['wav', 'webm', 'mp4', 'm4a', 'mp3', 'ogg'].includes(extension);
}

function parseDataUrl(dataUrl: string): ParsedDataUrl {
  const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/i);
  if (!match) {
    throw new Error('Attachment payload must be a base64 data URL');
  }
  return {
    mimeType: normalizeMimeType(match[1] || 'application/octet-stream'),
    buffer: Buffer.from(match[2] || '', 'base64'),
  };
}

function truncateText(value: string, maxChars = MAX_TEXT_CONTEXT_CHARS): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars).trimEnd()}\n\n[Truncated]`;
}

function extractOpenAiResponsesText(payload: OpenAiResponsesOutput): string {
  const direct = payload.output_text?.trim();
  if (direct) {
    return direct;
  }

  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        const trimmed = content.text.trim();
        if (trimmed) {
          chunks.push(trimmed);
        }
      }
    }
  }

  return chunks.join('\n\n').trim();
}

function ensureSinglePagePdf(buffer: Buffer): boolean {
  const raw = buffer.toString('latin1');
  const matches = raw.match(/\/Type\s*\/Page\b/g);
  const pageCount = matches?.length ?? 0;
  return pageCount <= 1;
}

function extractPdfTextNaive(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const chunks: string[] = [];
  const singleMatches = raw.matchAll(/\(([^()]*)\)\s*Tj/g);
  for (const match of singleMatches) {
    const text = decodePdfEscapes(match[1] || '').trim();
    if (text.length >= 2) {
      chunks.push(text);
    }
  }

  const arrayMatches = raw.matchAll(/\[(.*?)\]\s*TJ/gs);
  for (const match of arrayMatches) {
    const inner = match[1] || '';
    const segments = Array.from(inner.matchAll(/\(([^()]*)\)/g))
      .map((segment) => decodePdfEscapes(segment[1] || '').trim())
      .filter(Boolean);
    if (segments.length > 0) {
      chunks.push(segments.join(' '));
    }
  }

  return truncateText(chunks.join('\n'));
}

function decodePdfEscapes(value: string): string {
  return value
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function buildVisionPrompt(userPrompt: string | undefined, kind: VisionAttachmentKind): string {
  const prompt = userPrompt?.trim();
  if (prompt) {
    return `User request: ${prompt}\n\nUse the attached ${kind} to answer naturally and precisely. Quote visible facts only when supported by the attachment.`;
  }
  return `Analyze this ${kind} and answer naturally in chat style. Extract the important readable content, summarize it, and call out key facts, numbers, headings, or visible events.`;
}

export function validateVisionAttachment(
  payload: VisionAttachmentPayload,
): PreparedVisionAttachment {
  const name = String(payload.name || '').trim();
  const mimeType = normalizeMimeType(String(payload.mimeType || '').trim());
  const declaredSize = Number(payload.size);
  if (!name || !payload.dataUrl) {
    throw new Error('Attachment name and data are required');
  }

  const parsed = parseDataUrl(payload.dataUrl);
  const size = Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : parsed.buffer.length;

  if (isImageLike(name, mimeType)) {
    if (size > MAX_IMAGE_BYTES) {
      throw new Error('Image too large. Keep images under 6MB.');
    }
    return {
      kind: 'image',
      name,
      mimeType: mimeType || parsed.mimeType,
      size,
      buffer: parsed.buffer,
    };
  }

  if (isPdfLike(name, mimeType)) {
    if (size > MAX_PDF_BYTES) {
      throw new Error('PDF too large. Keep PDFs under 4MB.');
    }
    if (!ensureSinglePagePdf(parsed.buffer)) {
      throw new Error('Only single-page PDFs are supported right now.');
    }
    return {
      kind: 'pdf',
      name,
      mimeType: mimeType || parsed.mimeType || 'application/pdf',
      size,
      buffer: parsed.buffer,
    };
  }

  if (isTextLike(name, mimeType)) {
    if (size > MAX_TEXT_BYTES) {
      throw new Error('Text file too large. Keep text files under 1MB.');
    }
    return {
      kind: 'text',
      name,
      mimeType: mimeType || parsed.mimeType || 'text/plain',
      size,
      buffer: parsed.buffer,
    };
  }

  throw new Error('Unsupported attachment type. Use images, single-page PDFs, or small text files.');
}

async function createHermesImageAnswer(input: {
  attachment: PreparedVisionAttachment;
  prompt: string;
}): Promise<string> {
  const apiKey = process.env.HERMES_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Hermes vision is not configured on this server');
  }

  const dataUrl = `data:${input.attachment.mimeType || 'image/png'};base64,${input.attachment.buffer.toString('base64')}`;
  const baseUrl =
    process.env.HERMES_BASE_URL?.trim() || 'https://inference-api.nousresearch.com/v1';

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_HERMES_VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${input.prompt}\n\nReturn plain markdown-free text suitable for chat. If the image contains text, read it faithfully before summarizing.`,
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
      max_tokens: 1800,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw || `Hermes image analysis failed (${response.status})`);
  }

  const parsed = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = parsed.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) {
    throw new Error('Hermes returned no readable answer for this image');
  }
  return text;
}

async function createOpenAiAttachmentAnswer(input: {
  attachment: PreparedVisionAttachment;
  prompt: string;
}): Promise<string> {
  const apiKey = resolveOpenAiKey();
  if (!apiKey) {
    throw new Error('OpenAI fallback is not configured on this server');
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: 'input_text',
      text: `${input.prompt}\n\nReturn a direct natural-language answer. Do not output raw JSON.`,
    },
  ];

  if (input.attachment.kind === 'image') {
    content.push({
      type: 'input_image',
      image_url: `data:${input.attachment.mimeType};base64,${input.attachment.buffer.toString('base64')}`,
    });
  } else {
    content.push({
      type: 'input_file',
      filename: input.attachment.name,
      file_data: `data:${input.attachment.mimeType};base64,${input.attachment.buffer.toString('base64')}`,
    });
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_FILE_MODEL,
      input: [
        {
          role: 'user',
          content,
        },
      ],
      max_output_tokens: 1800,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw || `OpenAI attachment fallback failed (${response.status})`);
  }

  const parsed = JSON.parse(raw) as OpenAiResponsesOutput;
  const text = extractOpenAiResponsesText(parsed);
  if (!text) {
    throw new Error('OpenAI returned no readable answer for the attachment');
  }
  return text;
}

async function answerTextWithHermes(input: {
  attachment: PreparedVisionAttachment;
  prompt: string;
}): Promise<string> {
  const text = truncateText(input.attachment.buffer.toString('utf8'));
  if (!text) {
    throw new Error('No readable content found in the attachment');
  }

  return callHermesFast(
    'You are a file-reading assistant for AgentFlow. Answer based only on the attached text content. Be natural, concise, and faithful to the document.',
    `${input.prompt}\n\nAttached text:\n${text}`,
  );
}

async function answerPdfWithHermes(input: {
  attachment: PreparedVisionAttachment;
  prompt: string;
}): Promise<string> {
  const extracted = extractPdfTextNaive(input.attachment.buffer);
  if (!extracted || extracted.length < 40) {
    throw new Error('No reliable inline text could be extracted from this PDF');
  }

  return callHermesFast(
    'You are a PDF-reading assistant for AgentFlow. Answer based only on the extracted PDF text. If the text seems incomplete, say so briefly.',
    `${input.prompt}\n\nExtracted PDF text:\n${extracted}`,
  );
}

export async function analyzeAttachmentForChat(input: {
  attachment: VisionAttachmentPayload;
  prompt?: string;
}): Promise<VisionAnalysisResult> {
  const prepared = validateVisionAttachment(input.attachment);
  const prompt = buildVisionPrompt(input.prompt, prepared.kind);

  if (prepared.kind === 'image') {
    try {
      return {
        answer: await createHermesImageAnswer({ attachment: prepared, prompt }),
        sourceType: 'image',
        extractor: 'hermes',
        notes: ['Hermes vision completed the image analysis'],
      };
    } catch (error) {
      const fallback = await createOpenAiAttachmentAnswer({
        attachment: prepared,
        prompt,
      });
      return {
        answer: fallback,
        sourceType: 'image',
        extractor: 'openai-fallback',
        notes: [
          error instanceof Error ? error.message : 'Hermes image analysis failed',
          'OpenAI fallback answered the image request',
        ],
      };
    }
  }

  if (prepared.kind === 'text') {
    return {
      answer: await answerTextWithHermes({ attachment: prepared, prompt }),
      sourceType: 'text',
      extractor: 'hermes-text',
      notes: ['Hermes answered using the attached text content'],
    };
  }

  try {
    return {
      answer: await answerPdfWithHermes({ attachment: prepared, prompt }),
      sourceType: 'pdf',
      extractor: 'hermes-text',
      notes: ['Hermes answered from extracted single-page PDF text'],
    };
  } catch (error) {
    return {
      answer: await createOpenAiAttachmentAnswer({ attachment: prepared, prompt }),
      sourceType: 'pdf',
      extractor: 'openai-fallback',
      notes: [
        error instanceof Error ? error.message : 'Hermes PDF path failed',
        'OpenAI fallback answered the PDF request',
      ],
    };
  }
}

export function validateAudioPayload(payload: AudioPayload): {
  name: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
} {
  const name = String(payload.name || '').trim();
  const mimeType = normalizeMimeType(String(payload.mimeType || '').trim());
  const parsed = parseDataUrl(payload.dataUrl);
  const size = Number.isFinite(Number(payload.size)) && Number(payload.size) > 0
    ? Number(payload.size)
    : parsed.buffer.length;

  if (!name) {
    throw new Error('Audio name is required');
  }
  if (!isAudioLike(name, mimeType || parsed.mimeType)) {
    throw new Error('Unsupported audio type');
  }
  if (size > MAX_AUDIO_BYTES) {
    throw new Error('Audio file too large. Keep recordings under 4MB.');
  }

  return {
    name,
    mimeType: mimeType || parsed.mimeType || 'audio/wav',
    size,
    buffer: parsed.buffer,
  };
}

export function isLikelySilentWav(buffer: Buffer): boolean {
  if (buffer.length < 48) return false;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return false;
  }

  let offset = 12;
  let audioFormat = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > buffer.length) break;

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      audioFormat = buffer.readUInt16LE(chunkDataOffset);
      bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || bitsPerSample !== 16 || dataOffset < 0 || dataSize < 2) {
    return false;
  }

  const sampleCount = Math.floor(dataSize / 2);
  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = buffer.readInt16LE(dataOffset + index * 2) / 32768;
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return peak < 0.01 || rms < 0.0015;
}

export function validateAudioPayloadForTranscription(payload: AudioPayload): PreparedAudioPayload {
  const prepared = validateAudioPayload(payload);
  if (isLikelySilentWav(prepared.buffer)) {
    throw new Error(
      'Mic captured near-silence. Pick a different input device or unmute Windows, then try again.',
    );
  }
  return prepared;
}

function extensionForAudioType(type: string | undefined): string {
  if (!type) return 'webm';
  const normalized = type.toLowerCase();
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('ogg')) return 'ogg';
  return 'webm';
}

const TRANSCRIPTION_HALLUCINATIONS = new Set([
  'you',
  'you.',
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching.',
  'thanks for watching!',
  'thank you for watching',
  'thank you for watching.',
  'bye',
  'bye.',
  'bye!',
  '.',
  '...',
  'okay',
  'okay.',
]);

function isLikelyTranscriptionHallucination(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (normalized.length > 32) return false;
  return TRANSCRIPTION_HALLUCINATIONS.has(normalized);
}

async function runOpenAiTranscription(
  input: {
    buffer: Buffer;
    mimeType: string;
    name: string;
  },
  model: string,
  apiKey: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; raw: string }> {
  const form = new FormData();
  const fileBytes = new Uint8Array(input.buffer);
  form.append(
    'file',
    new Blob([fileBytes], { type: input.mimeType }),
    input.name || `recording.${extensionForAudioType(input.mimeType)}`,
  );
  form.append('model', model);
  form.append('response_format', 'json');
  if (DEFAULT_OPENAI_TRANSCRIPTION_LANGUAGE) {
    form.append('language', DEFAULT_OPENAI_TRANSCRIPTION_LANGUAGE);
  }
  form.append('temperature', '0');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const raw = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, raw };
  }

  const parsed = JSON.parse(raw) as { text?: string };
  return { ok: true, text: typeof parsed.text === 'string' ? parsed.text.trim() : '' };
}

export async function transcribeAudioForChat(input: {
  audio: AudioPayload;
}): Promise<{ text: string; model: string }> {
  const apiKey = resolveOpenAiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing on the server');
  }

  const prepared = validateAudioPayloadForTranscription(input.audio);
  const primary = await runOpenAiTranscription(prepared, DEFAULT_OPENAI_TRANSCRIPTION_MODEL, apiKey);
  if (!primary.ok) {
    throw new Error(primary.raw || `OpenAI transcription failed (${primary.status})`);
  }

  const primaryUsable =
    primary.text && !isLikelyTranscriptionHallucination(primary.text) ? primary.text : '';

  if (primaryUsable || DEFAULT_OPENAI_TRANSCRIPTION_MODEL === DEFAULT_OPENAI_TRANSCRIPTION_FALLBACK_MODEL) {
    return { text: primaryUsable, model: DEFAULT_OPENAI_TRANSCRIPTION_MODEL };
  }

  const fallback = await runOpenAiTranscription(
    prepared,
    DEFAULT_OPENAI_TRANSCRIPTION_FALLBACK_MODEL,
    apiKey,
  );
  if (!fallback.ok) {
    return { text: '', model: DEFAULT_OPENAI_TRANSCRIPTION_MODEL };
  }

  const fallbackUsable =
    fallback.text && !isLikelyTranscriptionHallucination(fallback.text) ? fallback.text : '';

  return {
    text: fallbackUsable,
    model: fallbackUsable
      ? DEFAULT_OPENAI_TRANSCRIPTION_FALLBACK_MODEL
      : DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  };
}
