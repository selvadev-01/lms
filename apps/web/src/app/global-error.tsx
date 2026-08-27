"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary — catches errors thrown in the root layout itself.
 * It replaces the whole document, so it must render its own <html>/<body>
 * and cannot rely on any provider or global stylesheet.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 8 }}>
          Something went wrong
        </h1>
        <p style={{ color: "#667085", marginBottom: 24 }}>
          The application failed to load.
          {error.digest ? ` Reference: ${error.digest}` : ""}
        </p>
        <button
          onClick={reset}
          style={{
            background: "#465fff",
            color: "#fff",
            border: 0,
            borderRadius: 8,
            padding: "10px 18px",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
