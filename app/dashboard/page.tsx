import { getRecentRunHistory } from "@/lib/status";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  completed: "#3fb950",
  rejected: "#d29922",
  failed: "#f85149",
  running: "#58a6ff",
  completed_with_errors: "#d29922",
};

function Badge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#8b949e";
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

export default async function DashboardPage() {
  const { batches, runs } = await getRecentRunHistory(50);

  return (
    <main style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1>Pipeline Dashboard</h1>
      <p style={{ color: "#8b949e" }}>
        Raw JSON at <code>/api/pipeline/status</code>. Manually trigger a run at{" "}
        <code>/api/pipeline/run?secret=YOUR_CRON_SECRET</code>.
      </p>

      <h2>Recent batches</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "2rem" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #30363d" }}>
            <th style={{ padding: 8 }}>Started</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Requested</th>
            <th style={{ padding: 8 }}>Succeeded</th>
            <th style={{ padding: 8 }}>Rejected</th>
            <th style={{ padding: 8 }}>Failed</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} style={{ borderBottom: "1px solid #21262d" }}>
              <td style={{ padding: 8 }}>{new Date(b.started_at).toLocaleString()}</td>
              <td style={{ padding: 8 }}>
                <Badge status={b.status} />
              </td>
              <td style={{ padding: 8 }}>{b.requested_count}</td>
              <td style={{ padding: 8 }}>{b.succeeded_count}</td>
              <td style={{ padding: 8 }}>{b.rejected_count}</td>
              <td style={{ padding: 8 }}>{b.failed_count}</td>
            </tr>
          ))}
          {batches.length === 0 && (
            <tr>
              <td style={{ padding: 8 }} colSpan={6}>
                No runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Recent designs/listings</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #30363d" }}>
            <th style={{ padding: 8 }}>Created</th>
            <th style={{ padding: 8 }}>Niche</th>
            <th style={{ padding: 8 }}>Theme</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Listing types</th>
            <th style={{ padding: 8 }}>Etsy listing</th>
            <th style={{ padding: 8 }}>Printify product(s)</th>
            <th style={{ padding: 8 }}>Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #21262d" }}>
              <td style={{ padding: 8 }}>{new Date(r.created_at).toLocaleString()}</td>
              <td style={{ padding: 8 }}>{r.niche_name ?? "—"}</td>
              <td style={{ padding: 8 }}>{r.theme ?? "—"}</td>
              <td style={{ padding: 8 }}>
                <Badge status={r.status} />
              </td>
              <td style={{ padding: 8 }}>{r.listing_types?.join(", ") || "—"}</td>
              <td style={{ padding: 8 }}>
                {r.etsy_listing_id ? (
                  <a
                    href={`https://www.etsy.com/your/shops/me/listing-editor/edit/${r.etsy_listing_id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#7db7ff" }}
                  >
                    {r.etsy_listing_id}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td style={{ padding: 8 }}>{r.printify_product_id ?? "—"}</td>
              <td style={{ padding: 8, color: "#f85149", maxWidth: 260 }}>{r.error_message ?? "—"}</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td style={{ padding: 8 }} colSpan={8}>
                No runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
