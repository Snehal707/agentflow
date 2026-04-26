import { NextRequest, NextResponse } from "next/server";
import { resolveOpenAiApiKey } from "@/lib/resolveOpenAiApiKey";

export const runtime = "nodejs";

/** Default speech-to-text model; override with OPENAI_TRANSCRIPTION_MODEL. See https://developers.openai.com/api/reference/resources/audio */
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_FALLBACK_TRANSCRIPTION_MODEL = "whisper-1";
const DEFAULT_TRANSCRIPTION_LANGUAGE =
  process.env.OPENAI_TRANSCRIPTION_LANGUAGE?.trim() || "en";

function extensionForAudioType(type: string | undefined): string {
  if (!type) return "webm";
  const normalized = type.toLowerCase();
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * Proxies audio to OpenAI speech-to-text (API key server-side only).
 * Expects multipart field `file` (audio/webm, audio/mp4, etc.).
 */
export async function POST(req: NextRequest) {
  const key = resolveOpenAiApiKey();
  if (!key) {
    return NextResponse.json(
      {
        error:
          "Server missing OPENAI_API_KEY. Add it to this app's .env.local (or .env) and restart `next dev`.",
      },
      { status: 503 },
    );
  }

  const model =
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL;
  const fallbackModel =
    process.env.OPENAI_TRANSCRIPTION_FALLBACK_MODEL?.trim() ||
    DEFAULT_FALLBACK_TRANSCRIPTION_MODEL;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Missing or empty audio file" }, { status: 400 });
  }

  const fileName =
    typeof (file as File).name === "string" && (file as File).name.trim()
      ? (file as File).name
      : `recording.${extensionForAudioType(file.type)}`;

  const runTranscription = async (selectedModel: string) => {
    const attempt = new FormData();
    attempt.append("file", file, fileName);
    attempt.append("model", selectedModel);
    attempt.append("response_format", "json");
    if (DEFAULT_TRANSCRIPTION_LANGUAGE) {
      attempt.append("language", DEFAULT_TRANSCRIPTION_LANGUAGE);
    }
    attempt.append("temperature", "0");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
      },
      body: attempt,
    });

    const raw = await response.text();
    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
        raw,
      };
    }

    try {
      const data = JSON.parse(raw) as { text?: string };
      return {
        ok: true as const,
        text: typeof data.text === "string" ? data.text : "",
      };
    } catch {
      return {
        ok: false as const,
        status: 502,
        raw: "Invalid response from transcription service",
      };
    }
  };

  const primary = await runTranscription(model);
  if (!primary.ok) {
    return NextResponse.json(
      { error: primary.raw || `OpenAI error (${primary.status})` },
      { status: primary.status >= 400 && primary.status < 600 ? primary.status : 502 },
    );
  }

  const primaryText = primary.text.trim();
  if (primaryText || fallbackModel === model) {
    return NextResponse.json({ text: primaryText });
  }

  const fallback = await runTranscription(fallbackModel);
  if (!fallback.ok) {
    return NextResponse.json({ text: primaryText });
  }

  return NextResponse.json({ text: fallback.text.trim() || primaryText });
}
