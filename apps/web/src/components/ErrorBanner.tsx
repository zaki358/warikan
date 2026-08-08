import { ApiError } from "../lib/api.js";

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;

  const message =
    error instanceof ApiError ? error.message : "予期しないエラーが発生しました。";

  return (
    <div role="alert" className="banner banner-danger">
      {message}
    </div>
  );
}
