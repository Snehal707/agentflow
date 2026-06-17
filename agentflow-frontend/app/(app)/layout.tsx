import dynamic from "next/dynamic";
import { AccessCodeGate } from "@/components/app/AccessCodeGate";

const Providers = dynamic(
  () => import("../providers").then((m) => m.Providers),
  { ssr: false },
);

export default function AppShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Providers>
      {children}
      <AccessCodeGate />
    </Providers>
  );
}
