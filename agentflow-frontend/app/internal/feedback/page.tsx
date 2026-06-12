import { Providers } from "@/app/providers";
import { FeedbackAdminPanel } from "@/components/internal/FeedbackAdminPanel";
import { isInternalMemoryMonitorEnabled } from "@/lib/internalAccess";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function InternalFeedbackPage() {
  if (!isInternalMemoryMonitorEnabled()) {
    notFound();
  }

  return (
    <Providers>
      <FeedbackAdminPanel />
    </Providers>
  );
}
