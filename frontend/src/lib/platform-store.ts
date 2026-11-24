export type PlatformValue = string | number | boolean | null;
export type PlatformRecord = { id: string; createdAt?: string; updatedAt?: string } & Record<string, PlatformValue>;
export type PlatformAuditEvent = { id: string; action: "created" | "updated" | "deleted"; collection: string; recordId: string; label: string; at: string };
export type PlatformStore = { version: 2; collections: Record<string, PlatformRecord[]>; activity: PlatformAuditEvent[] };

export const emptyPlatformStore = (): PlatformStore => ({ version: 2, collections: {}, activity: [] });

export function updatePlatformRecord(store: PlatformStore, collection: string, values: Record<string, PlatformValue>, id?: string): PlatformStore {
  const now = new Date().toISOString();
  const current = store.collections[collection] ?? [];
  const old = id ? current.find((record) => record.id === id) : undefined;
  const record: PlatformRecord = { ...old, ...values, id: old?.id ?? crypto.randomUUID(), createdAt: old?.createdAt ?? now, updatedAt: now };
  const records = old ? current.map((item) => (item.id === old.id ? record : item)) : [record, ...current];
  const event: PlatformAuditEvent = { id: crypto.randomUUID(), action: old ? "updated" : "created", collection, recordId: record.id, label: String(values.name ?? values.business ?? values.email ?? record.id), at: now };
  return { ...store, collections: { ...store.collections, [collection]: records }, activity: [event, ...store.activity].slice(0, 500) };
}

export function deletePlatformRecord(store: PlatformStore, collection: string, id: string): PlatformStore {
  const current = store.collections[collection] ?? [];
  const removed = current.find((record) => record.id === id);
  if (!removed) return store;
  const event: PlatformAuditEvent = { id: crypto.randomUUID(), action: "deleted", collection, recordId: id, label: String(removed.name ?? removed.business ?? removed.email ?? id), at: new Date().toISOString() };
  return { ...store, collections: { ...store.collections, [collection]: current.filter((record) => record.id !== id) }, activity: [event, ...store.activity].slice(0, 500) };
}
