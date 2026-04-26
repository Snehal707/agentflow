"use client";

import Image from "next/image";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "@/components/chat/types";

const MIC_DEVICE_STORAGE_KEY = "agentflow:selected-mic-id";
const ATTACHMENT_ACCEPT =
  ".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.csv,.json";

type AudioTranscriptionInput = {
  blob: Blob;
  name: string;
  mimeType: string;
  size: number;
};

type PromptValueUpdate = string | ((previous: string) => string);

type PromptComposerProps = {
  value: string;
  onChange: (value: PromptValueUpdate) => void;
  onSubmit: (event: FormEvent) => void;
  canSubmit?: boolean;
  isStreaming: boolean;
  placeholder: string;
  contextTags: ReadonlyArray<{ label: string; active: boolean }>;
  onToggleContext?: (label: string) => void;
  pendingAttachment?: ChatAttachment | null;
  onSelectAttachment?: (file: File) => Promise<void>;
  onClearAttachment?: () => void;
  onRequestTranscription?: (input: AudioTranscriptionInput) => Promise<string>;
  voicePaymentLabel?: string | null;
  size?: "hero" | "thread";
};

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

function extensionForAudioType(type: string | undefined): string {
  if (!type) return "webm";
  const normalized = type.toLowerCase();
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  return "webm";
}

function formatMicLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "Default microphone";

  const headsetMatch = trimmed.match(/^Headset Microphone\s*\((.+)\)$/i);
  if (headsetMatch) return `Headset ${headsetMatch[1]}`;

  const arrayMatch = trimmed.match(/^Microphone Array\s*\((.+)\)$/i);
  if (arrayMatch) return arrayMatch[1];

  const micMatch = trimmed.match(/^Microphone\s*\((.+)\)$/i);
  if (micMatch) return micMatch[1];

  return trimmed.replace(/^Microphone\s+/i, "").trim();
}

function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, pcm, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function normalizeAudioForTranscription(blob: Blob): Promise<{
  blob: Blob;
  durationSec: number | null;
  rms: number | null;
  peak: number | null;
}> {
  if (typeof window === "undefined") {
    return { blob, durationSec: null, rms: null, peak: null };
  }

  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) {
    return { blob, durationSec: null, rms: null, peak: null };
  }

  let audioContext: AudioContext | null = null;
  try {
    audioContext = new AudioContextCtor();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channelCount = Math.max(audioBuffer.numberOfChannels, 1);
    const mono = new Float32Array(audioBuffer.length);

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        mono[index] += data[index] / channelCount;
      }
    }

    let sumSquares = 0;
    let peak = 0;
    for (let index = 0; index < mono.length; index += 1) {
      const sample = mono[index] ?? 0;
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }

    return {
      blob,
      durationSec: audioBuffer.duration,
      rms: mono.length ? Math.sqrt(sumSquares / mono.length) : 0,
      peak,
    };
  } catch {
    return { blob, durationSec: null, rms: null, peak: null };
  } finally {
    await audioContext?.close().catch(() => undefined);
  }
}

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  canSubmit,
  isStreaming,
  placeholder,
  contextTags,
  onToggleContext,
  pendingAttachment,
  onSelectAttachment,
  onClearAttachment,
  onRequestTranscription,
  voicePaymentLabel,
  size = "hero",
}: PromptComposerProps) {
  const isHero = size === "hero";
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [isMicMenuOpen, setIsMicMenuOpen] = useState(false);
  const [isExtractingAttachment, setIsExtractingAttachment] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const micMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const canSend = canSubmit ?? Boolean(value.trim());
  const composerHeightClass = isHero ? "min-h-[92px]" : "min-h-[82px]";
  const textareaHeightClass = isHero ? "h-[72px]" : "h-[62px]";

  const refreshAudioInputDevices = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "audioinput",
      );
      setAudioInputDevices(devices);
      setSelectedMicId((current) => {
        const saved =
          current ||
          (typeof window !== "undefined"
            ? window.localStorage.getItem(MIC_DEVICE_STORAGE_KEY) ?? ""
            : "");
        if (saved && devices.some((device) => device.deviceId === saved)) {
          return saved;
        }
        return devices[0]?.deviceId ?? "";
      });
    } catch {
      // Ignore enumerate failures; the browser may still permit default audio capture.
    }
  }, []);

  const stopMeter = useCallback(() => {
    if (meterFrameRef.current !== null) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    if (typeof window === "undefined") return;

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) return;

    stopMeter();

    try {
      const audioContext = new AudioContextCtor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.fftSize);
      const tick = () => {
        const activeAnalyser = analyserRef.current;
        if (!activeAnalyser) return;

        activeAnalyser.getByteTimeDomainData(buffer);
        let sumSquares = 0;
        for (let index = 0; index < buffer.length; index += 1) {
          const normalized = (buffer[index] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        setMicLevel(Math.min(1, rms * 8));
        meterFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch {
      setMicLevel(0);
    }
  }, [stopMeter]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedMicId = window.localStorage.getItem(MIC_DEVICE_STORAGE_KEY);
      if (savedMicId) {
        setSelectedMicId(savedMicId);
      }
    }

    void refreshAudioInputDevices();

    const mediaDevices = navigator.mediaDevices;
    const handleDeviceChange = () => {
      void refreshAudioInputDevices();
    };

    mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);

    return () => {
      stopMeter();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, [refreshAudioInputDevices, stopMeter]);

  useEffect(() => {
    if (!pendingAttachment) {
      setAttachmentStatus(null);
    }
  }, [pendingAttachment]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!micMenuRef.current?.contains(event.target as Node)) {
        setIsMicMenuOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMicMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedMicId) return;
    window.localStorage.setItem(MIC_DEVICE_STORAGE_KEY, selectedMicId);
  }, [selectedMicId]);

  const stopStream = useCallback(() => {
    stopMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, [stopMeter]);

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      setIsTranscribing(true);
      setVoiceError(null);
      setVoiceStatus("Transcribing voice...");
      try {
        const prepared = await normalizeAudioForTranscription(blob);
        if (prepared.durationSec !== null && prepared.durationSec < 0.75) {
          setVoiceStatus(null);
          setVoiceError("Recording too short - hold the mic and speak for at least a second.");
          return;
        }
        if (
          (prepared.peak !== null && prepared.peak < 0.01) ||
          (prepared.rms !== null && prepared.rms < 0.0015)
        ) {
          setVoiceStatus(null);
          setVoiceError(
            "Mic captured near-silence. Pick the right input from the mic dropdown, unmute Windows, and try again.",
          );
          return;
        }
        if (!onRequestTranscription) {
          throw new Error("Voice transcription is not available right now.");
        }

        const text = (
          await onRequestTranscription({
            blob: prepared.blob,
            name: `recording.${extensionForAudioType(prepared.blob.type || blob.type)}`,
            mimeType: prepared.blob.type || blob.type || "audio/wav",
            size: prepared.blob.size,
          })
        ).trim();
        if (!text) {
          setVoiceStatus(null);
          setVoiceError(
            prepared.rms !== null && prepared.rms >= 0.00025
              ? "We captured audio, but couldn't recognize speech. Try speaking a bit louder or using a different mic input."
              : "No speech detected. Record a little longer (1-2s), speak clearly, then tap the mic again to stop.",
          );
          return;
        }
        onChange((previous) => {
          const latest = previous.trim();
          return latest ? `${latest} ${text}` : text;
        });
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
        });
        setVoiceStatus(`Transcribed: ${text}`);
      } catch (e) {
        setVoiceStatus(null);
        setVoiceError(e instanceof Error ? e.message : "Could not transcribe audio");
      } finally {
        setIsTranscribing(false);
      }
    },
    [onChange, onRequestTranscription],
  );

  const startRecording = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone is not available in this browser.");
      return;
    }
    setVoiceError(null);
    setVoiceStatus(null);
    try {
      const audioConstraints: MediaTrackConstraints = {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (selectedMicId) {
        audioConstraints.deviceId = { exact: selectedMicId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      streamRef.current = stream;
      chunksRef.current = [];
      startMeter(stream);
      void refreshAudioInputDevices();
      const mime = pickRecorderMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        if (blob.size < 256) {
          setVoiceError("Recording too short - hold the mic and speak for at least a second.");
          setIsRecording(false);
          return;
        }
        setIsRecording(false);
        void transcribeBlob(blob);
      };

      recorder.start();
      setIsRecording(true);
      setVoiceStatus("Recording... speak now, then click the mic again to stop.");
    } catch {
      setVoiceError("Microphone permission denied or unavailable.");
    }
  }, [refreshAudioInputDevices, selectedMicId, startMeter, stopStream, transcribeBlob]);

  const toggleMic = useCallback(() => {
    if (isStreaming || isTranscribing) return;
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    void startRecording();
  }, [isRecording, isStreaming, isTranscribing, startRecording]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    if (isStreaming || !canSend) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const micBusy = isStreaming || isTranscribing;
  const micLabel = isTranscribing ? "Transcribing..." : isRecording ? "Stop recording" : "Voice input";
  const showMicTools = audioInputDevices.length > 0 || isRecording || micLevel > 0;
  const activeMicIndex = audioInputDevices.findIndex((device) => device.deviceId === selectedMicId);
  const currentMicLabel =
    formatMicLabel(audioInputDevices.find((device) => device.deviceId === selectedMicId)?.label || "") ||
    (audioInputDevices.length > 0 && activeMicIndex >= 0
      ? `Microphone ${activeMicIndex + 1}`
      : "Default mic");
  const meterBars = [0.03, 0.08, 0.15, 0.24, 0.36, 0.5];

  const handleAttachmentSelect = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      setAttachmentError(null);
      setAttachmentStatus(null);

      if (!onSelectAttachment) {
        setAttachmentError("Attachments are not available right now.");
        return;
      }

      setIsExtractingAttachment(true);
      setAttachmentStatus(`Validating ${file.name}...`);

      try {
        await onSelectAttachment(file);
        setAttachmentStatus(`Ready to send ${file.name}`);
      } catch (error) {
        setAttachmentError(
          error instanceof Error ? error.message : "Attachment validation failed",
        );
      } finally {
        setIsExtractingAttachment(false);
      }
    },
    [onSelectAttachment],
  );

  return (
    <form onSubmit={onSubmit} className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={handleAttachmentSelect}
      />
      <div
        className={`relative mx-auto w-full max-w-5xl overflow-visible rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(35,35,33,0.96),rgba(20,20,19,0.98))] px-3 py-2 shadow-[0_28px_80px_-28px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.07)] ring-1 ring-[#f2ca50]/10 transition-colors focus-within:border-[#f2ca50]/35 focus-within:ring-[#f2ca50]/25 ${composerHeightClass}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || isTranscribing || isExtractingAttachment}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/45 transition hover:border-[#f2ca50]/35 hover:bg-[#f2ca50]/10 hover:text-[#f2ca50] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Attach context"
          >
            <span className="material-symbols-outlined text-[21px]">attach_file</span>
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`min-w-0 flex-1 resize-none bg-transparent px-2 py-4 text-[15px] leading-6 text-white/90 outline-none placeholder:text-white/30 ${textareaHeightClass}`}
          />

          <div className="flex flex-shrink-0 flex-col items-end gap-1 self-center">
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div ref={micMenuRef} className="relative flex items-center">
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={micBusy}
                  aria-label={micLabel}
                  aria-pressed={isRecording}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                    isRecording
                      ? "text-[#ff6b6b]"
                      : isTranscribing
                        ? "text-[#f2ca50]"
                        : "text-white/40 hover:text-[#f2ca50]"
                  }`}
                >
                  <span className={`material-symbols-outlined ${isTranscribing ? "animate-pulse" : ""}`}>
                    mic
                  </span>
                </button>
                {showMicTools ? (
                  <button
                    type="button"
                    onClick={() => setIsMicMenuOpen((open) => !open)}
                    aria-label="Choose microphone"
                    aria-expanded={isMicMenuOpen}
                    className="flex h-9 w-7 items-center justify-center rounded-full text-white/40 transition hover:bg-white/5 hover:text-[#f2ca50]"
                  >
                    <span className="material-symbols-outlined text-[14px]">expand_more</span>
                  </button>
                ) : null}
                {isMicMenuOpen ? (
                  <div
                    className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-xl border border-white/10 bg-[#1c1b1b] p-2 text-xs shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
                    role="menu"
                  >
                    <div className="flex items-center justify-between px-2 pt-1 pb-2 text-[10px] uppercase tracking-wider text-white/40">
                      <span>Input device</span>
                      <span>{currentMicLabel}</span>
                    </div>
                    <div className="flex items-center gap-1 px-2 pb-2">
                      {meterBars.map((threshold, index) => (
                        <span
                          key={index}
                          className={`h-1.5 flex-1 rounded-full transition-colors ${
                            micLevel >= threshold ? "bg-[#f2ca50]" : "bg-white/10"
                          }`}
                        />
                      ))}
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {audioInputDevices.length === 0 ? (
                        <div className="px-2 py-3 text-center text-white/40">
                          No microphones detected.
                        </div>
                      ) : (
                        audioInputDevices.map((device, index) => {
                          const label = formatMicLabel(device.label) || `Microphone ${index + 1}`;
                          const isActive = device.deviceId === selectedMicId;
                          return (
                            <button
                              key={device.deviceId || `${index}-${label}`}
                              type="button"
                              onClick={() => {
                                setSelectedMicId(device.deviceId);
                                setIsMicMenuOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition-colors ${
                                isActive
                                  ? "bg-[#2a2622] text-[#f2ca50]"
                                  : "text-white/80 hover:bg-white/5"
                              }`}
                            >
                              <span className="truncate pr-2">{label}</span>
                              {isActive ? (
                                <span className="material-symbols-outlined text-[16px]">check</span>
                              ) : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={isStreaming || !canSend}
                className="burnished-gold flex h-11 w-11 items-center justify-center rounded-full text-[#211800] transition hover:brightness-110 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={isStreaming ? "Running" : "Send"}
              >
                <span className="material-symbols-outlined text-[23px]">arrow_upward</span>
              </button>
            </div>
            {voiceError ? (
              <p className="max-w-[220px] text-right text-[10px] leading-snug text-[#ff6b6b]" role="alert">
                {voiceError}
              </p>
            ) : voiceStatus ? (
              <p className="max-w-[260px] text-right text-[10px] leading-snug text-[#f2ca50]" role="status">
                {voiceStatus}
              </p>
            ) : null}
          </div>
        </div>

        {pendingAttachment ? (
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-white/10 bg-[#201f1f] px-3 py-2">
            {pendingAttachment.kind === "image" && pendingAttachment.previewUrl ? (
              <Image
                src={pendingAttachment.previewUrl}
                alt={pendingAttachment.name}
                className="h-12 w-12 rounded-xl object-cover"
                width={48}
                height={48}
                unoptimized
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#2a2a2a]">
                <span className="material-symbols-outlined text-[#f2ca50]">
                  {pendingAttachment.kind === "pdf" ? "picture_as_pdf" : "description"}
                </span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white/90">
                {pendingAttachment.name}
              </div>
              <div className="text-xs text-white/40">
                {pendingAttachment.kind.toUpperCase()} ·{" "}
                {formatAttachmentSize(pendingAttachment.size)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setAttachmentStatus(null);
                setAttachmentError(null);
                onClearAttachment?.();
              }}
              className="rounded-lg p-1.5 text-white/40 transition hover:bg-[#2a2a2a] hover:text-white/90"
              aria-label="Remove attachment"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        ) : null}
      </div>

      {attachmentError ? (
        <p className="mx-auto mt-2 max-w-4xl px-2 text-left text-[11px] leading-snug text-[#ff6b6b]" role="alert">
          {attachmentError}
        </p>
      ) : attachmentStatus && !pendingAttachment ? (
        <p className="mx-auto mt-2 max-w-4xl px-2 text-left text-[11px] leading-snug text-[#9fb3c8]">
          {attachmentStatus}
        </p>
      ) : null}

      {voicePaymentLabel ? (
        <div className="mx-auto mt-2 max-w-4xl rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-[11px] text-[#f2ca50]">
          {voicePaymentLabel}
        </div>
      ) : null}

    </form>
  );
}
