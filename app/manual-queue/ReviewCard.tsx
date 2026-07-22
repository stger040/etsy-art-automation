"use client";

import { useState } from "react";
import type { ManualQueueItem } from "@/lib/status";

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        background: "#21262d",
        color: "#e8e8ea",
        border: "1px solid #30363d",
        borderRadius: 4,
        padding: "4px 10px",
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

export default function ReviewCard({
  run,
  suggestedBlueprintId,
  suggestedProviderId,
}: {
  run: ManualQueueItem;
  suggestedBlueprintId: string;
  suggestedProviderId: string;
}) {
  const [dismissed, setDismissed] = useState<null | "published" | "skipped">(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markAs(status: "published" | "skipped") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/manual-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id, status }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setDismissed(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  if (dismissed) {
    return (
      <div style={{ padding: 16, color: "#8b949e", border: "1px solid #21262d", borderRadius: 8 }}>
        Marked as {dismissed}. ({run.theme})
      </div>
    );
  }

  const tagsText = (run.etsy_tags ?? []).join(", ");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px 1fr",
        gap: 20,
        border: "1px solid #30363d",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div>
        {run.blob_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={run.blob_url} alt={run.theme ?? "design"} style={{ width: "100%", borderRadius: 6 }} />
        )}
        {run.blob_url && (
          <a
            href={run.blob_url}
            download
            style={{
              display: "block",
              marginTop: 8,
              textAlign: "center",
              background: "#238636",
              color: "white",
              borderRadius: 4,
              padding: "8px 0",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Download full image
          </a>
        )}
        {run.image_width && run.image_height && (
          <div style={{ color: "#8b949e", fontSize: 12, marginTop: 4, textAlign: "center" }}>
            {run.image_width}x{run.image_height}
          </div>
        )}
      </div>

      <div>
        <div style={{ color: "#8b949e", fontSize: 12, marginBottom: 4 }}>
          {run.niche_name} — {new Date(run.created_at).toLocaleString()}
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Title</strong>
            {run.etsy_title && <CopyButton label="Copy title" text={run.etsy_title} />}
          </div>
          <div style={{ padding: 8, background: "#161b22", borderRadius: 4, marginTop: 4 }}>{run.etsy_title}</div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Tags</strong>
            <CopyButton label="Copy tags" text={tagsText} />
          </div>
          <div style={{ padding: 8, background: "#161b22", borderRadius: 4, marginTop: 4, fontSize: 13 }}>
            {tagsText}
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Description</strong>
            {run.etsy_description && <CopyButton label="Copy description" text={run.etsy_description} />}
          </div>
          <div
            style={{
              padding: 8,
              background: "#161b22",
              borderRadius: 4,
              marginTop: 4,
              fontSize: 13,
              whiteSpace: "pre-wrap",
              maxHeight: 160,
              overflowY: "auto",
            }}
          >
            {run.etsy_description}
          </div>
        </div>

        <div style={{ color: "#8b949e", fontSize: 12, marginBottom: 10 }}>
          Suggested product in Printify's catalog: blueprint {suggestedBlueprintId}, print provider{" "}
          {suggestedProviderId} (same one the automation would have used) —{" "}
          <a href="https://printify.com/app/catalog" target="_blank" rel="noreferrer" style={{ color: "#7db7ff" }}>
            open Printify's catalog
          </a>{" "}
          to create it manually with the downloaded image.
        </div>

        {error && <div style={{ color: "#f85149", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            disabled={pending}
            onClick={() => markAs("published")}
            style={{
              background: "#238636",
              color: "white",
              border: "none",
              borderRadius: 4,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            I published this — mark done
          </button>
          <button
            disabled={pending}
            onClick={() => markAs("skipped")}
            style={{
              background: "#21262d",
              color: "#e8e8ea",
              border: "1px solid #30363d",
              borderRadius: 4,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            Skip this design
          </button>
        </div>
      </div>
    </div>
  );
}
