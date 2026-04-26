import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 1 * 1024 * 1024;

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/ld+json",
]);

type AttachmentKind = "image" | "pdf" | "text";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

function isImage(file: File): boolean {
  return (
    IMAGE_TYPES.has(file.type) ||
    ["png", "jpg", "jpeg", "webp", "gif"].includes(getExtension(file.name))
  );
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || getExtension(file.name) === "pdf";
}

function isTextLike(file: File): boolean {
  return (
    TEXT_TYPES.has(file.type) ||
    ["txt", "md", "csv", "json", "log"].includes(getExtension(file.name))
  );
}

async function ensureSinglePagePdf(file: File): Promise<boolean> {
  const arrayBuffer = await file.arrayBuffer();
  const raw = Buffer.from(arrayBuffer).toString("latin1");
  const matches = raw.match(/\/Type\s*\/Page\b/g);
  return (matches?.length ?? 0) <= 1;
}

async function verifyAttachmentSession(
  req: NextRequest,
): Promise<{ walletAddress: string } | null> {
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
      headers: { authorization },
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

async function validateAttachment(file: File): Promise<{
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
}> {
  if (isImage(file)) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("Image too large. Keep images under 6MB.");
    }
    return {
      kind: "image",
      name: file.name,
      mimeType: file.type || "image/png",
      size: file.size,
    };
  }

  if (isPdf(file)) {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error("PDF too large. Keep PDFs under 4MB.");
    }
    const singlePage = await ensureSinglePagePdf(file);
    if (!singlePage) {
      throw new Error("Only single-page PDFs are supported right now.");
    }
    return {
      kind: "pdf",
      name: file.name,
      mimeType: file.type || "application/pdf",
      size: file.size,
    };
  }

  if (isTextLike(file)) {
    if (file.size > MAX_TEXT_BYTES) {
      throw new Error("Text file too large. Keep text files under 1MB.");
    }
    return {
      kind: "text",
      name: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
    };
  }

  throw new Error(
    "Unsupported attachment type. Use images, single-page PDFs, or small text files.",
  );
}

export async function POST(req: NextRequest) {
  const session = await verifyAttachmentSession(req);
  if (!session) {
    return NextResponse.json(
      { error: "Sign in with your wallet before attaching files." },
      { status: 401 },
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

  try {
    const metadata = await validateAttachment(file);
    return NextResponse.json({
      ok: true,
      attachment: metadata,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Attachment validation failed" },
      { status: 400 },
    );
  }
}
