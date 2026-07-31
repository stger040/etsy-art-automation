"use client";

import { useState } from "react";
import type { ReactNode } from "react";
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

function CopyField({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{label}</strong>
        <CopyButton label={`Copy ${label.toLowerCase()}`} text={text} />
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
        {text}
      </div>
    </div>
  );
}

function ChannelSection({
  channelLabel,
  title,
  tags,
  description,
  footer,
}: {
  channelLabel: string;
  title: string | null;
  tags: string[] | null;
  description: string | null;
  footer?: ReactNode;
}) {
  return (
    <div style={{ border: "1px solid #21262d", borderRadius: 6, padding: 12, marginBottom: 12 }}>
      <div style={{ color: "#d29922", fontSize: 12, fontWeight: "bold", marginBottom: 8, textTransform: "uppercase" }}>
        {channelLabel} — failed to auto-publish
      </div>
      <CopyField label="Title" text={title} />
      <CopyField label="Tags" text={(tags ?? []).join(", ")} />
      <CopyField label="Description" text={description} />
      {footer}
    </div>
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
        <div style={{ color: "#8b949e", fontSize: 12, marginBottom: 10 }}>
          {run.niche_name} — {new Date(run.created_at).toLocaleString()}
        </div>

        {run.digital_failed && (
          <ChannelSection
            channelLabel="Digital download listing"
            title={run.etsy_title}
            tags={run.etsy_tags}
            description={run.etsy_description}
            footer={
              <div style={{ color: "#8b949e", fontSize: 12 }}>
                Create as a new digital download listing in Etsy's own listing editor (Shop Manager → Listings →
                Add a listing), upload the downloaded image as the digital file, and remember to check Etsy's
                "made with AI" disclosure box.
              </div>
            }
          />
        )}

        {run.physical_failed && (
          <ChannelSection
            channelLabel="Physical (Printify) listing"
            title={run.physical_etsy_title}
            tags={run.physical_etsy_tags}
            description={run.physical_etsy_description}
            footer={
              <div style={{ color: "#8b949e", fontSize: 12 }}>
                Suggested product: blueprint {suggestedBlueprintId}, print provider {suggestedProviderId} (same
                one the automation uses) —{" "}
                <a
                  href="https://printify.com/app/catalog"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#7db7ff" }}
                >
                  open Printify's catalog
                </a>{" "}
                to create it manually with the downloaded image.
              </div>
            }
          />
        )}

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
