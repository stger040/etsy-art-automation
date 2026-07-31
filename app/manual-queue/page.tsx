import Link from "next/link";
import { getManualQueue } from "@/lib/status";
import ReviewCard from "./ReviewCard";

export const dynamic = "force-dynamic";

export default async function ManualQueuePage() {
  const items = await getManualQueue();
  const suggestedBlueprintId = process.env.PRINTIFY_CANVAS_BLUEPRINT_ID || "937";
  const suggestedProviderId = process.env.PRINTIFY_CANVAS_PRINT_PROVIDER_ID || "99";

  return (
    <main style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <p>
        <Link href="/dashboard" style={{ color: "#7db7ff" }}>
          ← Back to dashboard
        </Link>
      </p>
      <h1>Manual publish queue</h1>
      <p style={{ color: "#8b949e" }}>
        Designs that passed the compliance check but failed to auto-publish on one or both channels (digital,
        physical, or both — each shown separately below when it applies). Download the image, copy the listing
        copy, and create the listing by hand. Mark it done here once you have, so it drops off this list.
      </p>

      {items.length === 0 && (
        <p style={{ color: "#8b949e", marginTop: "2rem" }}>Nothing waiting on manual review right now.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: "1.5rem" }}>
        {items.map((run) => (
          <ReviewCard
            key={run.id}
            run={run}
            suggestedBlueprintId={suggestedBlueprintId}
            suggestedProviderId={suggestedProviderId}
          />
        ))}
      </div>
    </main>
  );
}
