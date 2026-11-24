import { describe, expect, it } from "vitest";
import { defaultFlows, defaultGroups, groupReady, makeNode, memberError, MIN_FORWARD_NUMBERS, moveNode, nextStep, placeAt, removeNode, runHunt, type ForwardMember } from "@/lib/ivr";

const m = (id: string, state: ForwardMember["state"], enabled = true): ForwardMember => ({ id, name: id, number: `+25571200000${id.length}`, enabled, state });

describe("forwarding one number to many phones", () => {
  it("needs at least 7 switched-on phones before it can go live", () => {
    expect(MIN_FORWARD_NUMBERS).toBe(7);
    const members = Array.from({ length: 6 }, (_, i) => ({ ...m(`p${i}`, "available"), number: `+2557120000${i}` }));
    expect(groupReady({ verified: true, members })).toBe(false);
    expect(groupReady({ verified: true, members: [...members, { ...m("p6", "available"), number: "+25571200006" }] })).toBe(true);
  });

  it("skips busy and switched-off phones and connects the first free one", () => {
    const r = runHunt({ strategy: "sequential", lastAnsweredId: null, members: [m("a", "busy"), m("b", "available", false), m("c", "no-answer"), m("d", "available"), m("e", "available")] });
    expect(r.answeredBy?.id).toBe("d");
    expect(r.steps.map((s) => s.result)).toEqual(["busy", "off", "no-answer", "answered"]);
  });

  it("round-robin starts after the phone that answered last time", () => {
    const r = runHunt({ strategy: "round-robin", lastAnsweredId: "b", members: [m("a", "available"), m("b", "available"), m("c", "available")] });
    expect(r.answeredBy?.id).toBe("c");
  });

  it("reports nobody when every phone is busy", () => {
    expect(runHunt({ strategy: "simultaneous", lastAnsweredId: null, members: [m("a", "busy"), m("b", "no-answer")] }).answeredBy).toBeNull();
  });

  it("rejects duplicate numbers", () => {
    const g = defaultGroups()[0]!;
    expect(memberError(g.members, g.members[0]!.number)).toMatch(/already/);
  });
});

describe("caller menu flows", () => {
  it("follows the key the caller presses", () => {
    const f = defaultFlows()[0]!;
    expect(nextStep(f, "menu", "1")?.id).toBe("q-billing");
    expect(nextStep(f, "hours", "closed")?.id).toBe("vm");
  });

  it("reconnects the path when a step is removed", () => {
    const f = removeNode(defaultFlows()[0]!, "hours");
    expect(f.nodes["welcome"]?.next).toBeNull();
    const g = removeNode(defaultFlows()[0]!, "cb-msg");
    expect(g.nodes["menu"]?.options?.find((o) => o.key === "9")?.next).toBe("bye");
  });
});

describe("drag and drop in the caller menu builder", () => {
  it("dropping a message between two steps inserts it", () => {
    const f = defaultFlows()[0]!;
    const msg = { ...makeNode("message"), id: "new-msg" };
    const g = placeAt(f, "welcome", { type: "next" }, msg);
    expect(g.nodes["welcome"]?.next).toBe("new-msg");
    expect(g.nodes["new-msg"]?.next).toBe("hours");
  });

  it("moving a step takes it off its old place and attaches it to the new one", () => {
    const f = defaultFlows()[0]!;
    const g = moveNode(f, "bye", "menu", { type: "option", key: "1" })!;
    expect(g.nodes["menu"]?.options?.find((o) => o.key === "1")?.next).toBe("bye");
    expect(g.nodes["cb-msg"]?.next).toBeNull();
  });

  it("refuses to move the first step or drop a step inside its own branch", () => {
    const f = defaultFlows()[0]!;
    expect(moveNode(f, "welcome", "menu", { type: "option", key: "1" })).toBeNull();
    expect(moveNode(f, "hours", "menu", { type: "option", key: "1" })).toBeNull();
  });
});
