import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/server-api";
import "./admin.css";

type User = {
  id: string;
  email: string;
  is_root: boolean;
  document_count: number;
};
type Document = {
  id: string;
  user_id: string;
  email: string;
  name: string;
  status: string;
  created_at: string;
  error: string | null;
  has_input: boolean;
  has_output: boolean;
};

export default function Admin() {
  const [access, setAccess] = useState<"loading" | "login" | "denied" | "admin">("loading");
  const [visitors, setVisitors] = useState<{
    unique_browsers: number;
    active_24h: number;
    visits: number;
  } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [files, setFiles] = useState<Document[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [tab, setTab] = useState<"users" | "files">("users");

  async function refresh() {
    const me = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (me.status === 401) {
      setAccess("login");
      setUsers([]);
      setFiles([]);
      return;
    }
    if (!me.ok) throw new Error("Unable to check admin access. Check the backend and refresh.");
    if (!((await me.json()) as { is_root: boolean }).is_root) {
      setAccess("denied");
      setUsers([]);
      setFiles([]);
      return;
    }
    const [u, f] = await Promise.all([
      api("/admin/users").then((r) => r.json() as Promise<User[]>),
      api("/admin/files").then((r) => r.json() as Promise<Document[]>),
    ]);
    setVisitors(await (await api("/admin/visitors")).json());
    setUsers(u);
    setFiles(f);
    setAccess("admin");
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(refresh);
  }, []);
  function login(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      setPassword("");
      await refresh();
    });
  }
  function logout() {
    void run(async () => {
      await api("/auth/logout", { method: "POST" });
      setAccess("login");
      setUsers([]);
      setFiles([]);
    });
  }
  function remove(kind: "users" | "files", id: string, name: string) {
    if (
      !window.confirm(
        kind === "users"
          ? `Delete ${name} and all their stored files? This cannot be undone.`
          : `Delete ${name}, its stored input/output files, and OCR job? This cannot be undone.`,
      )
    )
      return;
    void run(async () => {
      await api(`/admin/${kind}/${id}`, { method: "DELETE" });
      await refresh();
    });
  }
  function download(file: Document, kind: "input" | "output") {
    void run(async () => {
      const blob = await (await api(`/admin/files/${file.id}/${kind}`)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file.name}-${kind}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  const term = query.toLowerCase();
  const visibleUsers = users.filter((u) => `${u.email} ${u.id}`.toLowerCase().includes(term));
  const visibleFiles = files.filter(
    (f) =>
      (!owner || f.user_id === owner) &&
      `${f.name} ${f.email} ${f.id}`.toLowerCase().includes(term),
  );
  return (
    <main className="admin-page">
      <header>
        <div>
          <a href="/">← PDF Park</a>
          <h1>Administration</h1>
          <p>Manage users and their stored documents.</p>
        </div>
        {(access === "admin" || access === "denied") && (
          <button disabled={busy} onClick={logout}>
            Sign out
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {access === "loading" && (
        <p>
          Checking access…{" "}
          <button disabled={busy} onClick={() => void run(refresh)}>
            Retry
          </button>
        </p>
      )}
      {access === "login" && (
        <form onSubmit={login} className="admin-login">
          <h2>Root admin sign in</h2>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={10}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}
      {access === "denied" && (
        <p role="alert">
          This account does not have root administrator access. Sign out and use the root account.
        </p>
      )}
      {access === "admin" && (
        <>
          <section className="admin-stats">
            <div>
              <strong>{users.length}</strong>Users
            </div>
            <div>
              <strong>{files.length}</strong>Document jobs
            </div>
            <div>
              <strong>
                {files.reduce((n, f) => n + Number(f.has_input) + Number(f.has_output), 0)}
              </strong>
              Stored files
            </div>
          </section>
          <p>
            Includes all server-retained OCR documents. Browser-only edits and temporary
            conversion/unlock files are not retained or linked to users.
          </p>
          {visitors && (
            <>
              <section className="admin-stats" aria-label="Visitor statistics">
                <div>
                  <strong>{visitors.unique_browsers}</strong>
                  Unique browsers
                </div>
                <div>
                  <strong>{visitors.visits}</strong>Editor visits
                </div>
                <div>
                  <strong>{visitors.active_24h}</strong>Active browsers (24h)
                </div>
              </section>
              <p>
                Each editor page load counts as a visit. Cookie-based browser counts are not people
                counts: clearing cookies or using another browser creates a new visitor. No
                location, IP address or fingerprint is stored by the tracker.
              </p>
            </>
          )}
          <nav aria-label="Admin views">
            <button
              aria-pressed={tab === "users"}
              onClick={() => {
                setTab("users");
                setQuery("");
              }}
            >
              Users
            </button>
            <button
              aria-pressed={tab === "files"}
              onClick={() => {
                setTab("files");
                setQuery("");
              }}
            >
              Files
            </button>
            <button disabled={busy} onClick={() => void run(refresh)}>
              Refresh
            </button>
          </nav>
          <div className="admin-filters">
            <label>
              Search
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, email, or ID"
              />
            </label>
            {tab === "files" && (
              <label>
                Owner
                <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">All users</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="admin-table" aria-busy={busy}>
            {tab === "users" ? (
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Documents</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.email}
                        <small>{u.id}</small>
                      </td>
                      <td>{u.is_root ? "Root admin" : "User"}</td>
                      <td>{u.document_count}</td>
                      <td>
                        <button
                          onClick={() => {
                            setOwner(u.id);
                            setQuery("");
                            setTab("files");
                          }}
                        >
                          View files
                        </button>{" "}
                        <button
                          className="danger"
                          disabled={busy || u.is_root}
                          onClick={() => remove("users", u.id, u.email)}
                        >
                          {u.is_root ? "Protected" : "Delete user"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!visibleUsers.length && (
                    <tr>
                      <td colSpan={4}>No users found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Owner</th>
                    <th>Status / created</th>
                    <th>Files / actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {f.name}
                        <small>{f.id}</small>
                      </td>
                      <td>{f.email}</td>
                      <td>
                        {f.status}
                        <small>{new Date(f.created_at).toLocaleString()}</small>
                        {f.error && <small>{f.error}</small>}
                      </td>
                      <td>
                        {f.has_input && (
                          <button disabled={busy} onClick={() => download(f, "input")}>
                            Input PDF
                          </button>
                        )}{" "}
                        {f.has_output && (
                          <button disabled={busy} onClick={() => download(f, "output")}>
                            Output PDF
                          </button>
                        )}{" "}
                        {!f.has_input && !f.has_output && <span>No retained file </span>}
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => remove("files", f.id, f.name)}
                        >
                          Delete document
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!visibleFiles.length && (
                    <tr>
                      <td colSpan={4}>No documents found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </main>
  );
}
