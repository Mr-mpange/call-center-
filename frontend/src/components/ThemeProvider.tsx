import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: (origin?: ThemeOrigin) => void;
  isTransitioning: boolean;
};

type ThemeOrigin = { x: number; y: number };

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => { finished: Promise<void> };
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const storageKey = "mpange.theme";

function readTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Keep the light theme when storage is unavailable.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const bootstrappedTheme = document.documentElement.dataset.theme;
    if (bootstrappedTheme === "light" || bootstrappedTheme === "dark") return bootstrappedTheme;
  }
  return readTheme();
}

function applyThemeToDocument(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // Theme still applies for the current session when storage is unavailable.
  }
}

function getThemeOrigin(origin?: ThemeOrigin): ThemeOrigin {
  if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) return origin;
  const toggle = document.querySelector<HTMLElement>("[data-theme-toggle]");
  if (toggle) {
    const rect = toggle.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function getRevealRadius({ x, y }: ThemeOrigin) {
  return Math.ceil(
    Math.max(
      Math.hypot(x, y),
      Math.hypot(window.innerWidth - x, y),
      Math.hypot(x, window.innerHeight - y),
      Math.hypot(window.innerWidth - x, window.innerHeight - y),
    ),
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Keep the first client render identical to SSR. The inline bootstrap script
  // applies the stored theme before hydration, so reading document.dataset in
  // the state initializer would make the button render dark on the client but
  // light in the server HTML.
  const [theme, setThemeState] = useState<Theme>("light");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionActive = useRef(false);

  useEffect(() => {
    setThemeState(getInitialTheme());
  }, []);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;

    const syncSystemTheme = (event: MediaQueryListEvent) => {
      try {
        if (window.localStorage.getItem(storageKey)) return;
      } catch {
        // Fall through to the system preference when storage is unavailable.
      }
      setThemeState(event.matches ? "dark" : "light");
    };

    media.addEventListener?.("change", syncSystemTheme);
    return () => media.removeEventListener?.("change", syncSystemTheme);
  }, []);

  const changeTheme = useCallback(
    (nextTheme: Theme, origin?: ThemeOrigin) => {
      if (nextTheme === theme || transitionActive.current) return;

      const root = document.documentElement;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const transitionDocument = document as ViewTransitionDocument;
      const canAnimate = Boolean(transitionDocument.startViewTransition) && !reducedMotion;

      persistTheme(nextTheme);

      const apply = () => {
        applyThemeToDocument(nextTheme);
        setThemeState(nextTheme);
      };

      if (!canAnimate) {
        apply();
        return;
      }

      transitionActive.current = true;
      setIsTransitioning(true);
      const themeOrigin = getThemeOrigin(origin);
      root.style.setProperty("--theme-origin-x", `${themeOrigin.x}px`);
      root.style.setProperty("--theme-origin-y", `${themeOrigin.y}px`);
      root.style.setProperty("--theme-reveal-radius", `${getRevealRadius(themeOrigin)}px`);
      root.dataset.themeTransitioning = "true";

      const finish = () => {
        transitionActive.current = false;
        setIsTransitioning(false);
        delete root.dataset.themeTransitioning;
        root.style.removeProperty("--theme-origin-x");
        root.style.removeProperty("--theme-origin-y");
        root.style.removeProperty("--theme-reveal-radius");
      };

      try {
        const transition = transitionDocument.startViewTransition!(apply);
        transition.finished.then(finish, finish);
      } catch {
        finish();
        apply();
      }
    },
    [theme],
  );

  const setTheme = useCallback((nextTheme: Theme) => changeTheme(nextTheme), [changeTheme]);
  const toggleTheme = useCallback(
    (origin?: ThemeOrigin) => changeTheme(theme === "light" ? "dark" : "light", origin),
    [changeTheme, theme],
  );

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      isTransitioning,
    }),
    [isTransitioning, setTheme, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
