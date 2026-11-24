import { useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  Circle,
  Delete,
  Grid3x3,
  Mic,
  MicOff,
  Minus,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import { fmtDuration } from "@/lib/format";
import type { Agent, CallRecord, Contact } from "@/lib/domain-types";
import { useApiCollection } from "@/lib/api";
import {
  formatNumber,
  initials,
  isDialable,
  KEYPAD,
  lookupName,
  normalizeDialInput,
} from "@/lib/phone";
import { cn } from "@/lib/utils";
import { usePhone, type ActiveCall } from "./PhoneProvider";

const keyCls =
  "soft-phone-key flex h-14 flex-col items-center justify-center rounded-full focus-visible:outline-none";

function Keypad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {KEYPAD.map(([k, sub]) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          className={keyCls}
          aria-label={`Key ${k}`}
        >
          <span className="font-display text-xl font-semibold leading-none">{k}</span>
          <span className="mt-0.5 h-3 text-[9px] tracking-[0.2em] text-muted-foreground">
            {sub}
          </span>
        </button>
      ))}
    </div>
  );
}

function statusText(c: ActiveCall, elapsed: number) {
  switch (c.status) {
    case "dialing":
      return "Calling…";
    case "ringing":
      return "Ringing…";
    case "incoming":
      return "Incoming call";
    case "connecting":
      return "Agent accepted · connecting audio";
    case "connected":
      return c.held ? `On hold · ${fmtDuration(elapsed)}` : `Connected · ${fmtDuration(elapsed)}`;
    case "ended":
      return "Call ended";
    default:
      return "";
  }
}

function Avatar({ c, size = "lg" }: { c: ActiveCall; size?: "lg" | "sm" }) {
  const pulsing = c.status === "ringing" || c.status === "incoming" || c.status === "dialing";
  return (
    <div className="relative grid place-items-center">
      {pulsing && (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" aria-hidden />
      )}
      <span
        className={cn(
          "soft-icon relative grid place-items-center font-display font-semibold text-primary",
          size === "lg" ? "h-20 w-20 text-2xl" : "h-11 w-11 text-sm",
        )}
      >
        {c.name ? initials(c.name) : <Phone className="h-6 w-6" />}
      </span>
    </div>
  );
}

function CallView() {
  const { call, elapsed, answer, decline, hangup, toggle, sendDigit, transfer } = usePhone();
  const [mode, setMode] = useState<"controls" | "keypad" | "transfer" | "notes">("controls");
  const [digits, setDigits] = useState("");
  const [notes, setNotes] = useState("");
  const { items: agents } = useApiCollection<Agent>("agents", [], "agents");
  if (!call) return null;
  const live = call.status === "connected";

  const controls = [
    {
      key: "mute",
      label: call.muted ? "Unmute" : "Mute",
      icon: call.muted ? MicOff : Mic,
      active: call.muted,
      onClick: () => toggle("muted"),
    },
    {
      key: "hold",
      label: call.held ? "Resume" : "Hold",
      icon: call.held ? Play : Pause,
      active: call.held,
      onClick: () => toggle("held"),
    },
    {
      key: "keypad",
      label: "Keypad",
      icon: Grid3x3,
      active: mode === "keypad",
      onClick: () => setMode(mode === "keypad" ? "controls" : "keypad"),
    },
    {
      key: "transfer",
      label: "Transfer",
      icon: ArrowRightLeft,
      active: mode === "transfer",
      onClick: () => setMode(mode === "transfer" ? "controls" : "transfer"),
    },
    {
      key: "record",
      label: call.recording ? "Stop rec" : "Record",
      icon: Circle,
      active: call.recording,
      onClick: () => toggle("recording"),
    },
    {
      key: "notes",
      label: "Notes",
      icon: StickyNote,
      active: mode === "notes",
      onClick: () => setMode(mode === "notes" ? "controls" : "notes"),
    },
  ];

  return (
    <div className="flex flex-col items-center gap-4 px-5 pb-5 pt-6">
      <div className="surface-recessed flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]">
        {call.direction === "inbound" ? (
          <PhoneIncoming className="h-3 w-3" />
        ) : (
          <PhoneOutgoing className="h-3 w-3" />
        )}
        {call.direction === "inbound" ? "Inbound" : "Outbound"}
        {call.recording && (
          <span className="ml-1 flex items-center gap-1 text-destructive">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
            REC
          </span>
        )}
      </div>
      {mode === "controls" || !live ? <Avatar c={call} /> : <Avatar c={call} size="sm" />}
      <div className="text-center">
        <p className="font-display text-lg font-semibold text-foreground">
          {call.name ?? formatNumber(call.number)}
        </p>
        {call.businessName && (
          <p className="text-xs font-medium text-primary">{call.businessName}</p>
        )}
        {call.name && <p className="font-mono text-xs">{formatNumber(call.number)}</p>}
        <p
          className={cn(
            "mt-1 font-mono text-sm font-medium",
            live
              ? "text-success"
              : call.status === "incoming"
                ? "text-primary"
                : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {statusText(call, elapsed)}
        </p>
      </div>

      {call.status === "incoming" ? (
        <div className="mt-2 flex w-full justify-around">
          <button
            type="button"
            onClick={decline}
            className="flex flex-col items-center gap-1.5 text-xs"
          >
            <span className="soft-button grid h-14 w-14 place-items-center rounded-full bg-destructive text-destructive-foreground">
              <PhoneOff className="h-6 w-6" />
            </span>
            Decline
          </button>
          <button
            type="button"
            onClick={answer}
            className="flex flex-col items-center gap-1.5 text-xs"
          >
            <span className="soft-button grid h-14 w-14 animate-bounce place-items-center rounded-full bg-success text-success-foreground">
              <Phone className="h-6 w-6" />
            </span>
            Answer
          </button>
        </div>
      ) : (
        <>
          {live && mode === "keypad" && (
            <div className="w-full space-y-3">
              <p className="h-6 text-center font-mono text-lg tracking-widest text-foreground">
                {digits}
              </p>
              <Keypad
                onKey={(k) => {
                  setDigits((d) => (d + k).slice(-16));
                  sendDigit(k);
                }}
              />
            </div>
          )}
          {live && mode === "transfer" && (
            <div className="w-full">
              <p className="mb-2 text-xs font-medium">Transfer to an available agent</p>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {agents
                  .filter((a) => a.status === "available")
                  .map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => transfer(a.name)}
                        className="soft-phone-list-item flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm"
                      >
                        <span>
                          <span className="block text-foreground">{a.name}</span>
                          <span className="text-[11px] text-muted-foreground">{a.team}</span>
                        </span>
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {live && mode === "notes" && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Type call notes…"
              aria-label="Call notes"
              className="soft-input h-32 w-full resize-none rounded-xl p-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          )}
          <div className="grid w-full grid-cols-3 gap-2">
            {controls.map(({ key, label, icon: Icon, active, onClick }) => (
              <button
                key={key}
                type="button"
                disabled={!live}
                onClick={onClick}
                aria-pressed={active}
                className={cn(
                  "soft-phone-key flex flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] disabled:opacity-35",
                  active && "text-primary",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={hangup}
            disabled={call.status === "ended"}
            aria-label="End call"
            className="soft-button grid h-14 w-14 place-items-center rounded-full bg-destructive text-destructive-foreground disabled:opacity-40"
          >
            <PhoneOff className="h-6 w-6" />
          </button>
        </>
      )}
    </div>
  );
}

function IdleView() {
  const { dial, sendDigit, log } = usePhone();
  const { items: contacts } = useApiCollection<Contact>("contacts", [], "contacts");
  const { items: backendCalls } = useApiCollection<CallRecord>("calls", [], "calls");
  const [tab, setTab] = useState<"keypad" | "recent" | "contacts">("keypad");
  const [num, setNum] = useState("");
  const [q, setQ] = useState("");
  const match = num ? lookupName(num) : null;
  const recentCalls = useMemo(() => {
    const sessionCalls = log.map((entry) => ({
      ...entry,
      at: new Date(entry.at).toISOString(),
    }));
    const sessionIds = new Set(sessionCalls.map((entry) => entry.id));
    const savedCalls = backendCalls
      .filter((entry) => !sessionIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        number: entry.phone,
        name: entry.caller && !/^unknown caller$/i.test(entry.caller) ? entry.caller : null,
        direction: entry.direction,
        at: entry.at,
        durationSec: entry.durationSec,
        outcome:
          entry.outcome === "resolved"
            ? "completed"
            : entry.outcome === "missed"
              ? "missed"
              : "cancelled",
      }));
    return [...sessionCalls, ...savedCalls].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [backendCalls, log]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-3 gap-1 p-2" role="tablist" aria-label="Phone sections">
        {(["keypad", "recent", "contacts"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="soft-phone-tab rounded-xl py-1.5 text-xs capitalize"
            data-active={tab === t}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "keypad" && (
        <div className="space-y-4 p-5">
          <div className="text-center">
            <input
              value={num}
              onChange={(e) => setNum(normalizeDialInput(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") dial(num);
              }}
              placeholder="Enter number"
              aria-label="Phone number"
              inputMode="tel"
              className="soft-input w-full rounded-xl py-2 text-center font-mono text-2xl text-foreground outline-none placeholder:text-base placeholder:text-muted-foreground"
            />
            <p className="h-4 text-xs text-primary">{match ?? ""}</p>
          </div>
          <Keypad
            onKey={(k) => {
              setNum((n) => normalizeDialInput(n + k));
              sendDigit(k);
            }}
          />
          <div className="grid grid-cols-3 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setNum((n) => (n.startsWith("+") ? n : "+" + n))}
              className="soft-phone-key mx-auto grid h-10 w-10 place-items-center rounded-full text-lg"
              aria-label="Add plus sign"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => dial(num)}
              disabled={!isDialable(num)}
              aria-label="Call"
              className="soft-button mx-auto grid h-14 w-14 place-items-center rounded-full bg-success text-success-foreground disabled:opacity-40"
            >
              <Phone className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => setNum((n) => n.slice(0, -1))}
              onDoubleClick={() => setNum("")}
              disabled={!num}
              className="soft-phone-key mx-auto grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"
              aria-label="Delete digit"
            >
              <Delete className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {tab === "recent" && (
        <ul className="max-h-[420px] flex-1 overflow-y-auto">
          {recentCalls.length === 0 && (
            <li className="p-6 text-center text-xs">
              No recent calls yet. Dial a number to get started.
            </li>
          )}
          {recentCalls.map((l) => {
            const Icon =
              l.outcome === "missed" || l.outcome === "declined"
                ? PhoneMissed
                : l.direction === "inbound"
                  ? PhoneIncoming
                  : PhoneOutgoing;
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => dial(l.number, l.name)}
                  className="soft-phone-list-item flex w-full items-center gap-3 px-4 py-2.5 text-left"
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      (l.outcome === "missed" || l.outcome === "declined") && "text-destructive",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {l.name ?? "Customer"}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {formatNumber(l.number)}
                    </span>
                    <span className="text-[11px] capitalize text-muted-foreground">
                      {l.outcome} · {fmtDuration(l.durationSec)}
                    </span>
                  </span>
                  <span className="font-mono text-[11px]">
                    {new Date(l.at).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {tab === "contacts" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative p-3">
            <Search
              className="absolute left-5.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              aria-hidden
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search contacts"
              aria-label="Search contacts"
              className="soft-input h-9 w-full rounded-xl pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-[380px] overflow-y-auto pb-2">
            {contacts
              .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
              .map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="soft-icon grid h-8 w-8 shrink-0 place-items-center text-[11px] font-semibold text-primary">
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{c.name}</span>
                    <span className="font-mono text-[11px]">{c.phone}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => dial(c.phone, c.name)}
                    disabled={c.doNotCall}
                    title={c.doNotCall ? "On do-not-call list" : `Call ${c.name}`}
                    aria-label={`Call ${c.name}`}
                    className="soft-button grid h-8 w-8 place-items-center rounded-full bg-success text-success-foreground disabled:opacity-35"
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function IncomingBanner() {
  const { call, answer, decline } = usePhone();
  if (!call) return null;
  return (
    <div
      role="alertdialog"
      aria-label="Incoming call"
      className="soft-phone fixed right-4 top-16 z-[60] flex w-[min(340px,calc(100vw-2rem))] items-center gap-3 rounded-[22px] p-3 animate-in slide-in-from-top-4 fade-in"
    >
      <Avatar c={call} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
          Incoming call
        </p>
        <p className="truncate text-sm font-semibold text-foreground">
          {call.name ?? formatNumber(call.number)}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">{formatNumber(call.number)}</p>
      </div>
      <button
        type="button"
        onClick={decline}
        aria-label="Decline call"
        className="soft-button grid h-10 w-10 place-items-center rounded-full bg-destructive text-destructive-foreground"
      >
        <PhoneOff className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={answer}
        aria-label="Answer call"
        className="soft-button grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground"
      >
        <Phone className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Softphone() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { open, setOpen, call, elapsed } = usePhone();
  if (pathname === "/login") return null;
  const live = call?.status === "connected";
  const label = !call
    ? "Phone"
    : call.status === "incoming"
      ? "Incoming…"
      : live
        ? fmtDuration(elapsed)
        : call.status === "ended"
          ? "Ended"
          : "Calling…";

  return (
    <>
      {call?.status === "incoming" && !open && <IncomingBanner />}
      {open && (
        <section
          aria-label="Softphone"
          className="soft-phone fixed bottom-24 right-4 z-50 flex max-h-[calc(100vh-7.5rem)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-y-auto rounded-[24px] animate-in fade-in slide-in-from-bottom-4"
        >
          <header className="flex items-center justify-between border-b border-border/30 px-4 py-3">
            <div>
              <p className="font-display text-sm font-semibold text-foreground">MPANGE Softphone</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Minimize phone"
              className="soft-icon h-8 w-8 text-muted-foreground hover:text-primary"
            >
              <Minus className="h-4 w-4" />
            </button>
          </header>
          {call ? <CallView key={call.id} /> : <IdleView />}
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close phone" : "Open phone"}
        aria-expanded={open}
        className={cn(
          "soft-button fixed bottom-5 right-4 z-50 grid h-14 w-14 place-items-center rounded-full p-0 focus-visible:outline-none",
          live
            ? "bg-success text-success-foreground"
            : call?.status === "incoming"
              ? "animate-pulse bg-warning text-foreground"
              : "bg-primary text-primary-foreground",
        )}
      >
        {open && !call ? <X className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
        <span className="sr-only">{label}</span>
      </button>
    </>
  );
}
