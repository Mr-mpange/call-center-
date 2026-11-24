import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Phone,
  Search,
  Bell,
  Menu,
  X,
  LogOut,
  ChevronDown,
  ShieldCheck,
  PanelLeftOpen,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePhone } from "@/components/phone/PhoneProvider";
import { fmtDuration } from "@/lib/format";
import { PrintHeader } from "@/components/kit";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { useApiCollection } from "@/lib/api";
import {
  getActiveNavigationItem,
  getNavigation,
  type ConfiguredPermission,
  type NavigationRole,
} from "@/lib/navigation";


const navigationRoleLabels: Record<NavigationRole, string> = {
  agent: "Agent",
  supervisor: "Supervisor",
  "tenant-admin": "Tenant Admin",
  "platform-admin": "Platform Admin",
};

type Account = {
  id?: string;
  name: string;
  email?: string;
  role: string;
  tenantId?: string;
  tenantName?: string;
  actingAsTenant?: boolean;
};

function readAccount(): Account {
  if (typeof window === "undefined") return { name: "", role: "Agent" };
  try { return JSON.parse(window.localStorage.getItem("mpange.auth.user") ?? "null") ?? { name: "", role: "Agent" }; } catch { return { name: "", role: "Agent" }; }
}

function navigationRoleForAccount(role: string): Extract<NavigationRole, "agent" | "supervisor"> {
  return role === "Supervisor" ? "supervisor" : "agent";
}

function signOut(navigate: ReturnType<typeof useNavigate>) {
  toast("Signed out");
  navigate({ to: "/login" });
}

function LogoutSlider({ collapsed = false, menuItem = false }: { collapsed?: boolean; menuItem?: boolean }) {
  const navigate = useNavigate();
  const sliderRef = useRef<HTMLButtonElement>(null);
  const pointerId = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  function metrics() {
    const slider = sliderRef.current;
    if (!slider) return null;
    const rect = slider.getBoundingClientRect();
    const knob = slider.querySelector<HTMLElement>("[data-logout-knob]");
    const knobWidth = knob?.getBoundingClientRect().width ?? 28;
    const padding = Number.parseFloat(getComputedStyle(slider).paddingLeft) || 0;
    const max = Math.max(0, rect.width - knobWidth - padding * 2);
    return { rect, knobWidth, padding, max };
  }

  function moveTo(clientX: number) {
    const current = metrics();
    if (!current) return 0;
    const nextOffset = Math.min(
      current.max,
      Math.max(0, clientX - current.rect.left - current.padding - current.knobWidth / 2),
    );
    const nextProgress = current.max === 0 ? 0 : nextOffset / current.max;
    setOffset(nextOffset);
    setProgress(nextProgress);
    return nextProgress;
  }

  function reset() {
    setOffset(0);
    setProgress(0);
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    if (pointerId.current !== event.pointerId) return;
    const nextProgress = moveTo(event.clientX);
    pointerId.current = null;
    setDragging(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer already released */ }
    if (nextProgress >= 0.86) {
      signOut(navigate);
    } else {
      reset();
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    pointerId.current = event.pointerId;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTo(event.clientX);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Home") {
      event.preventDefault();
      reset();
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "End") return;
    event.preventDefault();
    const current = metrics();
    const nextProgress = event.key === "End" ? 1 : Math.min(1, progress + 0.2);
    setProgress(nextProgress);
    setOffset((current?.max ?? 0) * nextProgress);
    if (nextProgress >= 1) signOut(navigate);
  }

  return (
    <button
      type="button"
      ref={sliderRef}
      className={cn(
        "logout-slider",
        menuItem && "logout-slider-menu",
        collapsed && "logout-slider-collapsed",
        dragging && "logout-slider-dragging",
      )}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-label="Hold and drag right to sign out"
      title={collapsed ? "Sign out" : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => {
        if (pointerId.current === event.pointerId) moveTo(event.clientX);
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        pointerId.current = null;
        setDragging(false);
        reset();
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="logout-slider-fill" style={{ width: `${progress * 100}%` }} aria-hidden />
      {!collapsed && <span className="logout-slider-label">Sign out</span>}
      <span
        data-logout-knob
        className="logout-slider-knob"
        style={{ transform: `translateX(${offset}px)` }}
        aria-hidden
      >
        <LogOut className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function SignOutMenuItem() {
  return <LogoutSlider menuItem />;
}

function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-2.5")}>
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">
        M
      </div>
      {!collapsed && <div className="leading-tight">
        <p className="font-display text-sm font-semibold tracking-wide text-sidebar-accent-foreground">
          MPANGE
        </p>
        <p className="text-[11px] text-sidebar-foreground">AI Call Center</p>
      </div>}
    </div>
  );
}

function RoleNavigation({
  role,
  onNavigate,
  collapsed = false,
  ariaLabel,
}: {
  role: NavigationRole;
  onNavigate?: (() => void) | undefined;
  collapsed?: boolean;
  ariaLabel: string;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { items: permissions } = useApiCollection<ConfiguredPermission>("role-permissions", [], "rolePermissions");
  const groups = getNavigation(role, permissions);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // TanStack Router can attach its active-link attributes before the client
  // location is available during SSR hydration. Defer our matching state until
  // the first client effect so server and client markup start identical.
  const activeItem = hydrated ? getActiveNavigationItem(groups, pathname) : undefined;
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("min-h-0 flex-1 space-y-5 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")}
    >
      {groups.map((group) => (
        (() => {
          const hasActiveItem = group.items.some((item) => item.id === activeItem?.id);
          const groupCollapsed = collapsedGroups[group.title] === true && !hasActiveItem;
          return <div key={group.title}>
          {!collapsed && (
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 pb-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              aria-expanded={!groupCollapsed}
              onClick={() => setCollapsedGroups((current) => ({ ...current, [group.title]: current[group.title] !== true }))}
            >
              {group.title}
              <ChevronDown className={cn("h-3 w-3 transition-transform", groupCollapsed && "-rotate-90")} aria-hidden />
            </button>
          )}
          <div className={cn("space-y-0.5", !collapsed && groupCollapsed && "hidden")}>
            {group.items.map(({ to, label, icon: Icon, id }) => {
              const isCurrent = activeItem?.id === id;
              return (
              <Link
                key={id}
                to={to as any}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                activeOptions={{ exact: true }}
                // TanStack Router adds active-link attributes from its client
                // location before hydration completes on SSR navigations.
                suppressHydrationWarning
                data-current={isCurrent ? "true" : "false"}
                className={cn(
                  "soft-nav-item group relative min-h-10 items-center gap-3 rounded-xl py-2 text-sm text-sidebar-foreground transition-colors hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  collapsed
                    ? "flex justify-center px-2"
                    : "grid grid-cols-[1.25rem_minmax(0,1fr)] px-3",
                  isCurrent && "font-medium text-sidebar-accent-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 justify-self-center",
                    isCurrent && "text-sidebar-primary",
                  )}
                  aria-hidden
                />
                {!collapsed && label}
              </Link>
              );
            })}
          </div>
          </div>;
        })()
      ))}
    </nav>
  );
}

function MobileNavigationMenu({ role, ariaLabel }: { role: NavigationRole; ariaLabel: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="soft-button soft-icon h-9 w-9 lg:hidden"
        aria-label="Open menu"
        title="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
        >
          <button
            type="button"
            className="absolute inset-0 bg-foreground/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside className="soft-sidebar relative flex h-screen max-h-screen w-64 flex-col overflow-y-auto bg-sidebar">
            <div className="flex items-center justify-between border-b border-sidebar-border px-5 py-4">
              <Logo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="soft-icon h-9 w-9 text-sidebar-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <RoleNavigation
              role={role}
              ariaLabel={ariaLabel}
              onNavigate={() => setOpen(false)}
            />
          </aside>
        </div>
      )}
    </>
  );
}

function PhoneStatusButton() {
  const { call, elapsed, setOpen } = usePhone();
  const live = call?.status === "connected";
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        "soft-button hidden items-center gap-1.5 rounded-full border-0 px-2.5 py-1 text-xs md:inline-flex",
        live
          ? "border-success/40 bg-success-soft text-success"
          : "border-border bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      <Phone className="h-3 w-3" />
      {live ? `On call · ${fmtDuration(elapsed)}` : call ? "Call in progress" : "Softphone ready"}
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navigationRole, setNavigationRole] = useState<Extract<NavigationRole, "agent" | "supervisor">>("agent");
  const [account, setAccount] = useState<Account>({ name: "", role: "Agent" });
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [q, setQ] = useState("");

  useEffect(() => {
    const current = readAccount();
    setAccount(current);
    setNavigationRole(navigationRoleForAccount(String(current.role)));
  }, []);

  if (pathname.startsWith("/admin/")) return <AdminShell>{children}</AdminShell>;

  return (
    <div className="soft-shell flex min-h-screen bg-background">
      <aside
        data-print-hide
        className={cn(
          "soft-sidebar sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar transition-[width] lg:flex",
          sidebarCollapsed ? "w-[72px]" : "w-60",
        )}
      >
        <div className={cn("flex items-center border-b border-sidebar-border py-4", sidebarCollapsed ? "justify-center px-2" : "justify-between px-5")}>
          <Logo collapsed={sidebarCollapsed} />
          <button
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            className={cn("soft-icon h-8 w-8 text-sidebar-foreground", sidebarCollapsed && "hidden")}
            aria-label="Collapse sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
        <RoleNavigation
          role={navigationRole}
          ariaLabel={`${navigationRoleLabels[navigationRole]} navigation`}
          collapsed={sidebarCollapsed}
        />
        <div className={cn("surface-recessed m-3 rounded-[18px] text-[11px] text-sidebar-foreground", sidebarCollapsed ? "grid place-items-center p-2" : "p-2.5")}>
          {!sidebarCollapsed && <>
            <p className="font-medium text-sidebar-accent-foreground">
              MPANGE TECHNOLOGY SOLUTION Ltd
            </p>
            <p className="mt-0.5">Enterprise plan · 42 seats</p>
          </>}
          {sidebarCollapsed && <button type="button" className="soft-icon h-8 w-8" onClick={() => setSidebarCollapsed(false)} aria-label="Expand sidebar">
            <Menu className="h-4 w-4" />
          </button>}
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            className="absolute inset-0 bg-foreground/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside className="soft-sidebar relative flex h-screen max-h-screen w-64 flex-col overflow-y-auto bg-sidebar">
            <div className="flex items-center justify-between border-b border-sidebar-border px-5 py-4">
              <Logo />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="soft-icon h-9 w-9 text-sidebar-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <RoleNavigation
              role={navigationRole}
              ariaLabel={`${navigationRoleLabels[navigationRole]} navigation`}
              onNavigate={() => setOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-print-hide
          className="soft-header sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6"
        >
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>

          <form
            className="relative max-w-md flex-1"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ to: "/history", search: q ? { q } : {} });
            }}
          >
            <Search
              className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search calls by caller, agent…"
              aria-label="Search calls"
              className="soft-input h-10 w-full rounded-xl border-0 bg-background pl-8 pr-3 text-sm outline-none"
            />
          </form>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <PhoneStatusButton />
            <Popover>
              <PopoverTrigger
                aria-label="Notifications"
                className="soft-button soft-icon h-9 w-9 hover:text-primary"
              >
                <Bell className="h-4 w-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0 text-sm">
                <p className="border-b border-border px-4 py-3 font-semibold">Notifications</p>
                <p className="px-4 py-5 text-sm text-muted-foreground">No notifications yet.</p>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="soft-button flex items-center gap-2 rounded-xl px-1.5 py-1"
                aria-label="Account menu"
              >
                <span className="soft-icon h-8 w-8 text-xs font-semibold text-accent-foreground">
                  {String(account.name || "User").split(/\s+/).map((part: string) => part[0]).join("").slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden text-left text-xs leading-tight sm:block">
                  <span className="block font-medium">{account.name || "User"}</span>
                  <span className="text-muted-foreground">{navigationRoleLabels[navigationRole]}</span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Signed-in account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/admin/settings">Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/help">Help</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <SignOutMenuItem />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="soft-main mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-4 pb-24 sm:p-6 sm:pb-24">
          <PrintHeader />
          {children}
        </main>
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="soft-shell flex min-h-screen bg-background">
      <aside
        data-print-hide
        className="soft-sidebar sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar lg:flex"
      >
        <Link to="/admin" className="border-b border-sidebar-border px-5 py-4">
          <Logo />
        </Link>
        <RoleNavigation role="tenant-admin" ariaLabel="Tenant administration" />
        <div className="m-3 grid gap-2">
          <Link
            to="/"
            className="surface-raised rounded-xl px-3 py-2 text-sm text-sidebar-foreground hover:text-sidebar-accent-foreground"
          >
            Back to operations
          </Link>
          <LogoutSlider />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header
          data-print-hide
          className="soft-header sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6"
        >
          <div className="flex items-center gap-2">
            <MobileNavigationMenu role="tenant-admin" ariaLabel="Tenant administration" />
            <p className="text-sm font-medium">Administration</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                className="soft-button flex items-center gap-2 rounded-xl bg-background px-1.5 py-1"
                aria-label="Admin profile menu"
              >
                <span className="soft-icon h-8 w-8 text-xs font-semibold text-accent-foreground">
                  HA
                </span>
                <span className="hidden text-left text-xs leading-tight sm:block">
                  <span className="block font-medium">Hassan Ally</span>
                  <span className="text-muted-foreground">Org Admin</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Admin account</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link to="/admin/settings">Profile & settings</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <SignOutMenuItem />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="soft-main mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6">
          <PrintHeader />
          {children}
        </main>
      </div>
    </div>
  );
}

export function SuperAdminShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("mpange.platform-sidebar-collapsed") === "true");
    } catch {
      /* use expanded navigation when storage is unavailable */
    }
  }, []);
  const toggleSidebar = () =>
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem("mpange.platform-sidebar-collapsed", String(next));
      } catch {
        /* state remains available for this page */
      }
      return next;
    });
  return (
    <div className="soft-shell flex min-h-screen bg-background">
      <aside
        data-print-hide
        className={cn(
          "soft-sidebar sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar transition-[width] lg:flex",
          collapsed ? "w-[72px]" : "w-60",
        )}
      >
        <Link
          to={"/platform/dashboard" as any}
          aria-label="Platform overview"
          className={cn(
            "flex min-h-[73px] items-center border-b border-sidebar-border py-4",
            collapsed ? "justify-center px-2" : "px-5",
          )}
        >
          {collapsed ? (
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">
              M
            </span>
          ) : (
            <Logo />
          )}
        </Link>
        <div className="border-b border-sidebar-border px-5 py-3">
          {!collapsed && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60">
                Platform console
              </p>
              <p className="mt-1 text-xs font-medium text-sidebar-accent-foreground">
                System owner
              </p>
            </>
          )}
        </div>
        <RoleNavigation role="platform-admin" ariaLabel="Platform administration" collapsed={collapsed} />
        {collapsed && <div className="m-3 grid gap-2">
          <button
            type="button"
            onClick={toggleSidebar}
            className="soft-icon h-9 w-9 self-center text-sidebar-foreground hover:text-sidebar-accent-foreground"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>}
      </aside>
      <div className="min-w-0 flex-1">
        <header
          data-print-hide
          className="soft-header sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6"
        >
          <div className="flex items-center gap-2">
            <MobileNavigationMenu role="platform-admin" ariaLabel="Platform administration" />
            <button
              type="button"
              onClick={toggleSidebar}
              className="soft-button hidden rounded-xl bg-background p-2 lg:inline-flex"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Menu className="h-4 w-4" />
            </button>
            <ShieldCheck className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">Platform administration</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                className="soft-button flex items-center gap-2 rounded-xl bg-background px-1.5 py-1"
                aria-label="System owner profile menu"
              >
                <span className="soft-icon h-8 w-8 bg-primary text-xs font-semibold text-primary-foreground">
                  SA
                </span>
                <span className="hidden text-left text-xs leading-tight sm:block">
                  <span className="block font-medium">System owner</span>
                  <span className="text-muted-foreground">Platform Admin</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Platform account</DropdownMenuLabel>
                <SignOutMenuItem />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="soft-main mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6">
          <PrintHeader />
          {children}
        </main>
      </div>
    </div>
  );
}
