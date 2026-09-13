export type OcrJob = {
  id: string;
  name: string;
  status: "queued" | "processing" | "completed" | "failed";
  created_at: string;
  error: string | null;
};

export async function api(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("X-PDF-Studio", "1");
  const response = await fetch("/api" + path, { ...options, credentials: "same-origin", headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new Error(
      typeof body?.detail === "string"
        ? body.detail
        : response.status === 413
          ? "The edited PDF exceeds the 40 MB server limit."
          : "Server request failed. Check that the backend is running and try again.",
    );
  }
  return response;
}
