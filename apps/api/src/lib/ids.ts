export const newId = (): string => crypto.randomUUID();

export const nowIso = (): string => new Date().toISOString();
