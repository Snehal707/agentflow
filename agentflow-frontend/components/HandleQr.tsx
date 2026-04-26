"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

type HandleQrProps = {
  value: string;
};

export function HandleQr({ value }: HandleQrProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void QRCode.toDataURL(value, {
      width: 256,
      margin: 1,
      color: {
        dark: "#0c0e12",
        light: "#ffffff",
      },
    })
      .then((nextUrl) => {
        if (active) {
          setDataUrl(nextUrl);
        }
      })
      .catch(() => {
        if (active) {
          setDataUrl(null);
        }
      });

    return () => {
      active = false;
    };
  }, [value]);

  return (
    <div className="rounded-[28px] border border-white/10 bg-white p-4 shadow-[0_30px_70px_rgba(5,8,18,0.35)]">
      {dataUrl ? (
        <Image
          src={dataUrl}
          alt="Payment QR code"
          className="h-56 w-56 rounded-[18px] bg-white object-contain"
          width={224}
          height={224}
          unoptimized
        />
      ) : (
        <div className="h-56 w-56 animate-pulse rounded-[18px] bg-[#d6d9de]" />
      )}
    </div>
  );
}
