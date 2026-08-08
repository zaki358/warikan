type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fields?: Record<string, string> } };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(
    code: string,
    message: string,
    status: number,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

const FALLBACK_MESSAGE = "通信に失敗しました。時間をおいて試してください。";

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    // オフラインや接続中断では fetch 自体が TypeError で reject する。
    // 素通しすると UI に英語の "Failed to fetch" が出るうえ、
    // 呼び出し側の instanceof ApiError による分岐から漏れる。
    // 応答が無いので status は 0 にする。
    throw new ApiError("NETWORK_ERROR", FALLBACK_MESSAGE, 0);
  }

  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    // JSON で返らないのはプロキシや Access の割り込み。中身は見せない。
    throw new ApiError("NETWORK_ERROR", FALLBACK_MESSAGE, response.status);
  }

  if (!envelope || typeof envelope !== "object" || !("ok" in envelope)) {
    throw new ApiError("NETWORK_ERROR", FALLBACK_MESSAGE, response.status);
  }

  if (!envelope.ok) {
    throw new ApiError(
      envelope.error.code,
      envelope.error.message,
      response.status,
      envelope.error.fields,
    );
  }

  return envelope.data;
}

export const apiGet = <T>(path: string): Promise<T> => request<T>(path, { method: "GET" });

export const apiSend = <T>(method: string, path: string, body?: unknown): Promise<T> =>
  request<T>(
    path,
    body === undefined
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
