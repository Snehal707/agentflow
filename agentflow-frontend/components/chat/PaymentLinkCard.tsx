"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import QRCode from "qrcode";

type PaymentLinkCardProps = {
  handle: string;
  displayHandle: string;
  amount: string | null;
  remark: string | null;
  /** Relative path+query, e.g. "/pay/jack?amount=5&remark=coffee" */
  path: string;
};

/**
 * Renders a payment-link card with:
 *   - A small, visible QR (SVG, crisp at any DPI).
 *   - Copy / Share / Open buttons that act on the URL.
 *   - Share QR / Download QR buttons that export the QR as a PNG image.
 *
 * PNG generation uses the `qrcode` npm package directly (no hidden DOM canvas)
 * so the blob is available on the first click regardless of render state.
 * Cascade for "Share QR image":
 *   1. Mobile: native share sheet with PNG attached (WhatsApp/Messages/…).
 *   2. Desktop: clipboard image write — paste straight into WhatsApp Web,
 *      Slack, Gmail, Telegram desktop, etc.
 *   3. Fallback: download the PNG to the user's filesystem.
 * Each branch sets a clear, visible notice so the user knows what happened.
 */
export function PaymentLinkCard({
  displayHandle,
  amount,
  remark,
  path,
}: PaymentLinkCardProps) {
  // Build the shareable URL from the current host. Works on localhost in dev
  // and on the deployed domain in prod without any extra config.
  const [origin, setOrigin] = useState<string>("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const fullUrl = useMemo(() => {
    if (!origin) return path;
    return `${origin.replace(/\/+$/, "")}${path}`;
  }, [origin, path]);

  const [linkCopied, setLinkCopied] = useState(false);
  const [shareNotice, setShareNotice] = useState<string>("");
  const [shareError, setShareError] = useState<string>("");
  const [working, setWorking] = useState<"share-qr" | "download-qr" | null>(null);

  const resetNotices = () => {
    setShareNotice("");
    setShareError("");
  };

  const safeFilenamePart = (s: string) =>
    s.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "link";

  const fileName = `pay-${safeFilenamePart(displayHandle)}${
    amount ? `-${safeFilenamePart(amount)}USDC` : ""
  }.png`;

  // ----- URL share helpers -------------------------------------------------

  const handleCopyLink = async () => {
    resetNotices();
    try {
      await navigator.clipboard.writeText(fullUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      setShareError("Clipboard blocked. Long-press the link above to copy.");
    }
  };

  const handleShareLink = async () => {
    resetNotices();
    const shareText = `Pay ${displayHandle}${amount ? ` ${amount} USDC` : ""}${
      remark ? ` — ${remark}` : ""
    }`;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `Pay ${displayHandle}`,
          text: shareText,
          url: fullUrl,
        });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
      }
    }
    await handleCopyLink();
    setShareNotice("Link copied — paste it wherever you need.");
  };

  // ----- QR image export (PNG via qrcode package) --------------------------

  const generateQrPngBlob = async (): Promise<Blob> => {
    // 640px gives a crisp scan even when pasted small into a chat client.
    const dataUrl = await QRCode.toDataURL(fullUrl, {
      errorCorrectionLevel: "M",
      width: 640,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
    const response = await fetch(dataUrl);
    return response.blob();
  };

  const isMobileDevice = () => {
    if (typeof navigator === "undefined") return false;
    return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
  };

  /** Returns "shared" | "cancelled" | "unsupported" | "error". */
  const tryNativeShare = async (
    file: File,
  ): Promise<"shared" | "cancelled" | "unsupported" | "error"> => {
    if (typeof navigator === "undefined") return "unsupported";
    if (typeof navigator.share !== "function") return "unsupported";
    if (typeof navigator.canShare !== "function") return "unsupported";
    if (!navigator.canShare({ files: [file] })) return "unsupported";
    try {
      await navigator.share({
        files: [file],
        title: `Pay ${displayHandle}`,
        text: `Pay ${displayHandle}${amount ? ` ${amount} USDC` : ""}${
          remark ? ` — ${remark}` : ""
        }`,
      });
      return "shared";
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "AbortError") return "cancelled";
      return "error";
    }
  };

  /** Returns "copied" | "unsupported" | "error". */
  const tryClipboardImage = async (
    blob: Blob,
  ): Promise<"copied" | "unsupported" | "error"> => {
    if (typeof navigator === "undefined") return "unsupported";
    if (!navigator.clipboard || typeof navigator.clipboard.write !== "function") {
      return "unsupported";
    }
    const CI =
      typeof window !== "undefined"
        ? (window as unknown as { ClipboardItem?: typeof ClipboardItem })
            .ClipboardItem
        : undefined;
    if (!CI) return "unsupported";
    // Chrome requires the document to be focused for clipboard.write.
    if (typeof document !== "undefined" && typeof document.hasFocus === "function" && !document.hasFocus()) {
      window.focus();
    }
    try {
      await navigator.clipboard.write([new CI({ "image/png": blob })]);
      return "copied";
    } catch {
      return "error";
    }
  };

  const handleShareQr = async () => {
    if (working) return;
    resetNotices();
    setWorking("share-qr");
    try {
      let blob: Blob;
      try {
        blob = await generateQrPngBlob();
      } catch (err) {
        setShareError(err instanceof Error ? err.message : "QR export failed.");
        return;
      }
      const file = new File([blob], fileName, { type: "image/png" });
      const mobile = isMobileDevice();

      // Mobile: native share → clipboard → download.
      // Desktop: clipboard → download (skip native share; Windows flyout is flaky).
      if (mobile) {
        const shareResult = await tryNativeShare(file);
        if (shareResult === "shared" || shareResult === "cancelled") return;
      }

      const copyResult = await tryClipboardImage(blob);
      if (copyResult === "copied") {
        setShareNotice(
          mobile
            ? "QR image copied. Paste it into any chat."
            : "QR image copied. Paste it into WhatsApp Web, Slack, email, etc.",
        );
        return;
      }

      // Desktop: try native share as a secondary attempt only if clipboard failed.
      if (!mobile) {
        const shareResult = await tryNativeShare(file);
        if (shareResult === "shared" || shareResult === "cancelled") return;
      }

      // Final fallback — always works.
      downloadBlob(blob, fileName);
      setShareNotice(`Saved ${fileName} to your downloads — attach it from there.`);
    } finally {
      setWorking(null);
    }
  };

  const handleDownloadQr = async () => {
    if (working) return;
    resetNotices();
    setWorking("download-qr");
    try {
      const blob = await generateQrPngBlob();
      downloadBlob(blob, fileName);
      setShareNotice(`Saved ${fileName} to your downloads.`);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#111318] p-4 sm:flex-row sm:items-start">
      {/* Visible QR — small, crisp SVG for inline display */}
      <div className="flex shrink-0 items-center justify-center rounded-xl bg-white p-2">
        <QRCodeSVG
          value={fullUrl}
          size={140}
          level="M"
          marginSize={0}
          aria-label={`QR code for paying ${displayHandle}`}
        />
      </div>

      {/* Meta + actions */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-[0.18em] text-white/40">
            Payment link
          </div>
          <div className="text-sm font-medium text-white">
            Pay {displayHandle}
            {amount ? (
              <span className="text-[#69daff]"> · {amount} USDC</span>
            ) : null}
          </div>
          {remark ? (
            <div className="truncate text-xs text-white/50">“{remark}”</div>
          ) : null}
        </div>

        <a
          href={fullUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 font-mono text-[11px] text-[#69daff] transition hover:border-[#69daff]/40"
          title={fullUrl}
        >
          {fullUrl || path}
        </a>

        {/* Row 1 — share the URL text */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#201f1f] px-4 py-1.5 text-xs font-medium text-white/80 transition hover:border-[#69daff]/40 hover:text-white"
          >
            {linkCopied ? "Copied!" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={handleShareLink}
            className="inline-flex items-center gap-2 rounded-full border border-[#69daff]/35 bg-[#69daff]/10 px-4 py-1.5 text-xs font-medium text-[#69daff] transition hover:bg-[#69daff]/20"
          >
            Share link
          </button>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#201f1f] px-4 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/30 hover:text-white"
          >
            Open
          </a>
        </div>

        {/* Row 2 — share the QR as an image */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleShareQr}
            disabled={working !== null}
            className="inline-flex items-center gap-2 rounded-full border border-[#f2ca50]/35 bg-[#f2ca50]/10 px-4 py-1.5 text-xs font-medium text-[#f2ca50] transition hover:bg-[#f2ca50]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working === "share-qr" ? "Preparing…" : "Share QR image"}
          </button>
          <button
            type="button"
            onClick={handleDownloadQr}
            disabled={working !== null}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#201f1f] px-4 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working === "download-qr" ? "Saving…" : "Download QR"}
          </button>
        </div>

        {shareNotice ? (
          <div className="text-[11px] text-white/55">{shareNotice}</div>
        ) : null}
        {shareError ? (
          <div className="text-[11px] text-red-400">{shareError}</div>
        ) : null}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
