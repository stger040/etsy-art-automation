import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ padding: "3rem", maxWidth: 640 }}>
      <h1>Etsy Art Automation</h1>
      <p>Automated design generation and listing pipeline.</p>
      <p>
        <Link href="/dashboard" style={{ color: "#7db7ff" }}>
          View pipeline dashboard →
        </Link>
      </p>
    </main>
  );
}
