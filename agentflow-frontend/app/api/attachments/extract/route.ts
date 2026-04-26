import { NextRequest, NextResponse } from "next/server";
import { resolveOpenAiApiKey } from "@/lib/resolveOpenAiApiKey";

export const runtime = "nodejs";

const DEFAULT_FILE_EXTRACTION_MODEL = "gpt-4.1-mini";
const DEFAULT_HERMES_VISION_MODEL =
  process.env.HERMES_VISION_MODEL?.trim() || "google/gemma-4-26b-a4b-it";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 1 * 1024 * 1024;
const MAX_RETURN_CHARS = 6000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const DAILY_MEDIA_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const MAX_OPENAI_FALLBACKS_PER_WINDOW = 3;
const MAX_MEDIA_UPLOADS_PER_DAY = 5;

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const PLAIN_TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/ld+json",
]);

const FILE_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/ld+json",
]);

type AttachmentRateBucket = {
  requests: number[];
  openaiFallbacks: number[];
  mediaUploads: number[];
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

const attachmentRateStore = new Map<string, AttachmentRateBucket>();

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

function isPlainTextLike(file: File) {
  return (
    PLAIN_TEXT_TYPES.has(file.type) ||
    ["txt", "md", "csv", "json", "log"].includes(getExtension(file.name))
  );
}

function isImage(file: File) {
  return (
    IMAGE_TYPES.has(file.type) ||
    ["png", "jpg", "jpeg", "webp", "gif"].includes(getExtension(file.name))
  );
}

function isSupportedFile(file: File) {
  return isImage(file) || FILE_TYPES.has(file.type) || ["pdf", "txt", "md", "csv", "json", "log"].includes(getExtension(file.name));
}

function isPdf(file: File) {
  return file.type === "application/pdf" || getExtension(file.name) === "pdf";
}

function truncateText(text: string, maxChars = MAX_RETURN_CHARS) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n\n[Truncated for chat context]`;
}

function extractOpenAiResponsesText(payload: OpenAiResponsesOutput): string {
  const direct = payload.output_text?.trim();
  if (direct) {
    return direct;
  }

  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        const trimmed = content.text.trim();
        if (trimmed) {
          chunks.push(trimmed);
        }
      }
    }
  }

  return chunks.join("\n\n").trim();
}

function getFileSizeLimit(file: File) {
  if (isPlainTextLike(file)) return MAX_TEXT_BYTES;
  if (isImage(file)) return MAX_IMAGE_BYTES;
  return MAX_DOCUMENT_BYTES;
}

function getRequestKey(input: { walletAddress: string; ip: string }) {
  return `${input.walletAddress.toLowerCase()}::${input.ip}`;
}

function checkRateLimit(key: string, bucket: keyof AttachmentRateBucket, limit: number) {
  const now = Date.now();
  const state = attachmentRateStore.get(key) ?? {
    requests: [],
    openaiFallbacks: [],
    mediaUploads: [],
  };
  state.requests = state.requests.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  state.openaiFallbacks = state.openaiFallbacks.filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  state.mediaUploads = (state.mediaUploads ?? []).filter(
    (timestamp) => now - timestamp < DAILY_MEDIA_WINDOW_MS,
  );

  const entries = state[bucket];
  if (entries.length >= limit) {
    attachmentRateStore.set(key, state);
    return false;
  }

  entries.push(now);
  attachmentRateStore.set(key, state);
  return true;
}

async function ensureSinglePagePdf(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const raw = Buffer.from(arrayBuffer).toString("latin1");
  const matches = raw.match(/\/Type\s*\/Page\b/g);
  const pageCount = matches?.length ?? 0;
  return pageCount <= 1;
}

async function verifyAttachmentSession(req: NextRequest) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const backend = normalizeBaseUrl(
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000",
  );

  try {
    const response = await fetch(`${backend}/api/auth/refresh`, {
      method: "POST",
      headers: {
        authorization,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      walletAddress?: string;
    };

    if (!payload.walletAddress) {
      return null;
    }

    return {
      walletAddress: payload.walletAddress,
    };
  } catch {
    return null;
  }
}

function resolveHermesConfig() {
  const apiKey = process.env.HERMES_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl:
      process.env.HERMES_BASE_URL?.trim() || "https://inference-api.nousresearch.com/v1",
    model: DEFAULT_HERMES_VISION_MODEL,
  };
}

async function createOpenAiFileExtraction(input: {
  key: string;
  file: File;
}): Promise<string> {
  const arrayBuffer = await input.file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const model =
    process.env.OPENAI_FILE_EXTRACTION_MODEL?.trim() || DEFAULT_FILE_EXTRACTION_MODEL;

  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text:
        "Prepare this attachment for use inside a chat. Extract the important readable content faithfully in plain text. Preserve headings, bullets, table rows, and key numbers. If the file is long, start with a short summary, then include the most relevant extracted text. Keep the total under 6000 characters. If this is an image with little or no text, briefly describe what is visible. Return plain text only.",
    },
  ];

  if (isImage(input.file)) {
    content.push({
      type: "input_image",
      image_url: `data:${input.file.type || "image/png"};base64,${base64}`,
    });
  } else {
    content.push({
      type: "input_file",
      filename: input.file.name || "attachment",
      file_data: `data:${input.file.type || "application/octet-stream"};base64,${base64}`,
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.key}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content,
        },
      ],
      max_output_tokens: 1800,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw || `OpenAI extraction failed (${response.status})`);
  }

  let parsed: OpenAiResponsesOutput;
  try {
    parsed = JSON.parse(raw) as OpenAiResponsesOutput;
  } catch {
    throw new Error("Invalid attachment extraction response");
  }

  const text = extractOpenAiResponsesText(parsed);
  if (!text) {
    throw new Error("No readable content found in the attachment");
  }
  return truncateText(text);
}

async function createHermesImageExtraction(input: { file: File }): Promise<string> {
  const hermes = resolveHermesConfig();
  if (!hermes) {
    throw new Error("Hermes vision is not configured on this server");
  }

  const arrayBuffer = await input.file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const dataUrl = `data:${input.file.type || "image/png"};base64,${base64}`;

  const response = await fetch(`${hermes.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hermes.apiKey}`,
    },
    body: JSON.stringify({
      model: hermes.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract the important readable text from this image faithfully in plain text. Preserve headings, bullets, and numbers. If there is little or no text, briefly describe the image. Keep the result under 6000 characters. Return plain text only.",
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 1600,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw || `Hermes image extraction failed (${response.status})`);
  }

  let parsed:
    | {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      }
    | undefined;

  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error("Invalid Hermes image extraction response");
  }

  const text = parsed?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("Hermes returned no readable image text");
  }

  return truncateText(text);
}

export async function POST(req: NextRequest) {
  const session = await verifyAttachmentSession(req);
  if (!session) {
    return NextResponse.json(
      { error: "Sign in with your wallet before attaching files." },
      { status: 401 },
    );
  }

  const requestKey = getRequestKey({
    walletAddress: session.walletAddress,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
  });

  if (!checkRateLimit(requestKey, "requests", MAX_REQUESTS_PER_WINDOW)) {
    return NextResponse.json(
      { error: "Attachment limit reached. Try again in a few minutes." },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Missing or empty file" }, { status: 400 });
  }

  if (!isSupportedFile(file)) {
    return NextResponse.json(
      {
        error:
          "Unsupported file type. Use images, single-page PDFs, or small text files like txt, md, csv, or json.",
      },
      { status: 415 },
    );
  }

  const fileSizeLimit = getFileSizeLimit(file);
  if (file.size > fileSizeLimit) {
    return NextResponse.json(
      {
        error: `File too large. Keep this file type under ${Math.round(
          fileSizeLimit / (1024 * 1024),
        )}MB.`,
      },
      { status: 413 },
    );
  }

  if ((isImage(file) || isPdf(file)) && !checkRateLimit(requestKey, "mediaUploads", MAX_MEDIA_UPLOADS_PER_DAY)) {
    return NextResponse.json(
      { error: "Daily upload cap reached. You can upload up to 5 images/PDFs per day." },
      { status: 429 },
    );
  }

  try {
    if (isPlainTextLike(file)) {
      const text = truncateText((await file.text()).trim());
      if (!text) {
        return NextResponse.json({ error: "The selected file is empty." }, { status: 400 });
      }
      return NextResponse.json({
        text,
        fileName: file.name,
        sourceType: "text",
      });
    }

    if (isPdf(file)) {
      const singlePage = await ensureSinglePagePdf(file);
      if (!singlePage) {
        return NextResponse.json(
          {
            error:
              "Only single-page PDFs are supported right now. Split large PDFs before uploading.",
          },
          { status: 400 },
        );
      }
    }

    if (isImage(file)) {
      try {
        const text = await createHermesImageExtraction({ file });
        return NextResponse.json({
          text,
          fileName: file.name,
          sourceType: "image",
          extractor: "hermes",
        });
      } catch (hermesError) {
        const openAiKey = resolveOpenAiApiKey();
        if (!openAiKey) {
          throw hermesError;
        }
        if (
          !checkRateLimit(
            requestKey,
            "openaiFallbacks",
            MAX_OPENAI_FALLBACKS_PER_WINDOW,
          )
        ) {
          return NextResponse.json(
            {
              error:
                "Image OCR fallback limit reached for this session. Try again later or use a smaller/clearer image.",
            },
            { status: 429 },
          );
        }

        const text = await createOpenAiFileExtraction({ key: openAiKey, file });
        return NextResponse.json({
          text,
          fileName: file.name,
          sourceType: "image",
          extractor: "openai-fallback",
        });
      }
    }

    const openAiKey = resolveOpenAiApiKey();
    if (!openAiKey) {
      return NextResponse.json(
        {
          error:
            "This attachment type currently needs OpenAI file extraction, but OPENAI_API_KEY is missing on the server.",
        },
        { status: 503 },
      );
    }
    if (
      !checkRateLimit(requestKey, "openaiFallbacks", MAX_OPENAI_FALLBACKS_PER_WINDOW)
    ) {
      return NextResponse.json(
        {
          error:
            "Document extraction limit reached for this session. Try again later or use a smaller file.",
        },
        { status: 429 },
      );
    }

    const text = await createOpenAiFileExtraction({ key: openAiKey, file });
    return NextResponse.json({
      text,
      fileName: file.name,
      sourceType: isImage(file) ? "image" : "document",
      extractor: "openai",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Attachment extraction failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
