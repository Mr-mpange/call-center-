import { describe, expect, it } from "vitest";
import { deletePlatformRecord, emptyPlatformStore, updatePlatformRecord } from "@/lib/platform-store";

describe("platform store transformations", () => {
  it("starts empty and records created data in memory", () => {
    const initial = emptyPlatformStore();
    expect(initial.collections).toEqual({});
    const created = updatePlatformRecord(initial, "businesses", { name: "Entered business", status: "Active" });
    const record = created.collections.businesses?.[0];
    expect(record?.name).toBe("Entered business");
    expect(created.activity[0]?.action).toBe("created");
  });

  it("updates and deletes records without browser storage", () => {
    const created = updatePlatformRecord(emptyPlatformStore(), "businesses", { name: "Entered business", status: "Active" });
    const record = created.collections.businesses?.[0];
    const updated = updatePlatformRecord(created, "businesses", { name: "Renamed business" }, record?.id);
    expect(updated.collections.businesses?.[0]?.name).toBe("Renamed business");
    expect(updated.activity[0]?.action).toBe("updated");
    const deleted = deletePlatformRecord(updated, "businesses", record!.id);
    expect(deleted.collections.businesses).toEqual([]);
    expect(deleted.activity[0]?.action).toBe("deleted");
  });
});
