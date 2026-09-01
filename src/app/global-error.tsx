"use client";

import { useEffect } from "react";

// Root error boundary.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("global_error_boundary", { digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: "1rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: "#6b7076", marginTop: 8 }}>Please try again in a moment.</p>
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: "0.5rem 1rem", borderRadius: 6, border: "1px solid #e6e7e9", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
