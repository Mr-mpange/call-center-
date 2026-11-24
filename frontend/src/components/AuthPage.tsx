import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Headphones } from "lucide-react";
import { apiPost } from "@/lib/api";
import { landingPathForRole } from "@/lib/navigation";

export type AuthMode = "signin" | "register";

export function AuthPage({ initialMode = "signin" }: { initialMode?: AuthMode } = {}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const isRegister = mode === "register";

  function switchMode(next: AuthMode) {
    setMode(next);
    setMessage("");
    setVisible({});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRegister && password !== confirm) {
      setMessage("Your passwords do not match.");
      return;
    }
    try {
      const response = await apiPost<{ token: string; user: unknown }>(
        isRegister ? "auth/register" : "auth/login",
        { name, email, password },
      );
      window.localStorage.setItem("mpange.auth.token", response.token);
      window.localStorage.setItem("mpange.auth.user", JSON.stringify(response.user));
      window.dispatchEvent(new Event("mpange:auth-ready"));
      setMessage(
        isRegister
          ? "Account created. Opening your workspace…"
          : "Signed in. Opening your workspace…",
      );
      const role =
        typeof response.user === "object" && response.user !== null && "role" in response.user
          ? String((response.user as { role?: unknown }).role ?? "")
          : "";
      await navigate({ to: landingPathForRole(role) });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to connect to the backend.");
    }
  }

  function togglePassword(field: string) {
    setVisible((current) => ({ ...current, [field]: !current[field] }));
  }

  return (
    <main className="auth-stage">
      <div className={`auth-shell${isRegister ? " is-register" : ""}`}>
        <section className="auth-panel auth-form-panel" aria-label="Account access form">
          <div className="auth-brand">
            <span className="auth-logo">
              <Headphones size={25} strokeWidth={1.8} />
            </span>
            <span className="auth-brand-name">
              Mpange<small>CALL CENTER</small>
            </span>
          </div>
          <div className="auth-content">
            <div className="auth-tag">YOUR WORKSPACE STARTS HERE</div>
            <h1>{isRegister ? "Create your account." : "Welcome back."}</h1>
            <p className="auth-subtitle">
              {isRegister
                ? "Join the Mpange workspace and make every customer interaction count."
                : "Sign in to your account to continue supporting every conversation."}
            </p>
            <div className="auth-tabs" role="tablist" aria-label="Account access">
              <button
                type="button"
                role="tab"
                aria-selected={!isRegister}
                className={!isRegister ? "active" : ""}
                onClick={() => switchMode("signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isRegister}
                className={isRegister ? "active" : ""}
                onClick={() => switchMode("register")}
              >
                Register
              </button>
            </div>
            <form onSubmit={submit} className="auth-fields">
              {isRegister && (
                <div className="auth-field">
                  <label htmlFor="auth-name">Full name</label>
                  <input
                    id="auth-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    placeholder="Enter your full name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              )}
              <div className="auth-field">
                <label htmlFor="auth-email">Email address</label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@company.com"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="auth-password">Password</label>
                <div className="auth-relative">
                  <input
                    id="auth-password"
                    name="password"
                    type={visible.password ? "text" : "password"}
                    minLength={8}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    placeholder="Enter your password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    className="auth-show"
                    type="button"
                    onClick={() => togglePassword("password")}
                    aria-label={visible.password ? "Hide password" : "Show password"}
                  >
                    {visible.password ? <EyeOff size={15} /> : <Eye size={15} />}
                    <span>{visible.password ? "Hide" : "Show"}</span>
                  </button>
                </div>
              </div>
              {isRegister && (
                <div className="auth-field">
                  <label htmlFor="auth-confirm">Confirm password</label>
                  <div className="auth-relative">
                    <input
                      id="auth-confirm"
                      name="confirm"
                      type={visible.confirm ? "text" : "password"}
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="Confirm your password"
                      required
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                    />
                    <button
                      className="auth-show"
                      type="button"
                      onClick={() => togglePassword("confirm")}
                      aria-label={visible.confirm ? "Hide password" : "Show password"}
                    >
                      {visible.confirm ? <EyeOff size={15} /> : <Eye size={15} />}
                      <span>{visible.confirm ? "Hide" : "Show"}</span>
                    </button>
                  </div>
                </div>
              )}
              {!isRegister && (
                <div className="auth-line">
                  <label>
                    <input type="checkbox" defaultChecked /> Remember me
                  </label>
                  <button
                    className="auth-link"
                    type="button"
                    onClick={() =>
                      setMessage(
                        "Password recovery is unavailable because no authentication service is connected.",
                      )
                    }
                  >
                    Forgot password?
                  </button>
                </div>
              )}
              <button className="auth-submit" type="submit">
                <span>{isRegister ? "Create Mpange account" : "Sign in to Mpange"}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <div
                className={`auth-message${message ? " visible" : ""}`}
                role="status"
                aria-live="polite"
              >
                {message}
              </div>
            </form>
            <div className="auth-foot">
              <span>{isRegister ? "Already have an account?" : "New to Mpange?"}</span>
              <Link to={isRegister ? "/login" : "/register"}>
                {isRegister ? "Sign in instead" : "Create an account"}
              </Link>
            </div>
          </div>
          <footer className="auth-copyright">
            © 2026 Mpange Call Center · Designed for better conversations
          </footer>
        </section>
        <section
          className="auth-panel auth-image-panel"
          aria-label="Mpange Call Center team member at work"
        >
          <img
            className="auth-photo"
            src="/mpange-auth.jpg"
            alt="Mpange Call Center agent supporting customers at work"
          />
          <div className="auth-image-caption">
            <span className="auth-eyebrow">MPANGE CALL CENTER</span>
            <h2>
              {isRegister
                ? "Be part of better conversations."
                : "Every conversation deserves attention."}
            </h2>
            <p>
              {isRegister
                ? "Your journey to remarkable customer support starts here."
                : "A smarter place to connect with customers, support your team, and deliver exceptional service."}
            </p>
          </div>
        </section>
        <div className="auth-divider" aria-hidden="true" />
      </div>
    </main>
  );
}
