export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const err = <T = never>(error: string): Result<T> => ({ ok: false, error });
