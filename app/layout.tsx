export const metadata = {
  title: "Etsy Art Automation",
  description: "Pipeline dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0b0c0f", color: "#e8e8ea" }}>
        {children}
      </body>
    </html>
  );
}
