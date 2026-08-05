export type Ok<T> = { ok: true; data: T };
export type Fail = {
  ok: false;
  error: { code: string; message: string; fields?: Record<string, string> };
};

export const ok = <T>(data: T): Ok<T> => ({ ok: true, data });

export const fail = (code: string, message: string, fields?: Record<string, string>): Fail => ({
  ok: false,
  error: fields ? { code, message, fields } : { code, message },
});
