import { Providers } from "@/app/providers";
import { ReviewAdminPanel } from "@/components/internal/ReviewAdminPanel";
import { isInternalMemoryMonitorEnabled } from "@/lib/internalAccess";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function InternalReviewPage() {
  if (!isInternalMemoryMonitorEnabled()) {
    notFound();
  }

  return (
    <Providers>
      <ReviewAdminPanel />
    </Providers>
  );
}
