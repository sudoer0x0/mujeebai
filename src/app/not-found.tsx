import Link from "next/link";

export default function RootNotFound() {
  return (
    <html lang="en">
      <body style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Page not found</h1>
          <p style={{ color: "#6b7076" }}>
            <Link href="/">Go home</Link>
          </p>
        </div>
      </body>
    </html>
  );
}
