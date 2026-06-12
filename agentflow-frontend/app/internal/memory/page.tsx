import { Providers } from "@/app/providers";
import { MemoryAdminPanel } from "@/components/internal/MemoryAdminPanel";
import { isInternalMemoryMonitorEnabled } from "@/lib/internalAccess";
import { notFound } from "next/navigation";

export default function InternalMemoryPage() {
  if (!isInternalMemoryMonitorEnabled()) {
    notFound();
  }

  return (
    <Providers>
      <MemoryAdminPanel routeLabel="/internal/memory" />
    </Providers>
  );
}
