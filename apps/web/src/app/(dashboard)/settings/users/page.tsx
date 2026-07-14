'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { RoleBadge } from '@/components/role-badge';
import { ROLES, type Role, type UserView } from '@/lib/types';

export default function UsersSettingsPage() {
  const [users, setUsers] = useState<UserView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetFor, setResetFor] = useState<UserView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.get<UserView[]>('/users'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium text-slate-200">Users</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          + New user
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              users.map((u) => (
                <tr key={u.id} className="text-slate-300">
                  <td className="px-4 py-2">{u.name ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-400">{u.email}</td>
                  <td className="px-4 py-2">
                    <select
                      value={u.role}
                      onChange={(e) =>
                        act(() =>
                          api.patch(`/users/${u.id}/role`, { role: e.target.value as Role }),
                        )
                      }
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <span className={u.status === 'ACTIVE' ? 'text-emerald-400' : 'text-amber-400'}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setResetFor(u)}
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                      >
                        Reset pw
                      </button>
                      {u.status === 'ACTIVE' ? (
                        <button
                          onClick={() => act(() => api.patch(`/users/${u.id}/disable`))}
                          className="rounded border border-red-900/60 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                        >
                          Disable
                        </button>
                      ) : (
                        <button
                          onClick={() => act(() => api.patch(`/users/${u.id}/enable`))}
                          className="rounded border border-emerald-900/60 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950/40"
                        >
                          Enable
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
          onError={setError}
        />
      )}
      {resetFor && (
        <ResetPasswordDialog
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => setResetFor(null)}
          onError={setError}
        />
      )}
    </div>
  );
}

function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <h3 className="mb-4 text-base font-medium text-slate-100">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('WORKER');
  const [tempPassword, setTempPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/users', { email, name: name || undefined, role, tempPassword });
      onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Create failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="Create user">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Name (optional)">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={inputCls}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Temporary password">
          <input
            type="text"
            required
            minLength={8}
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            className={inputCls}
          />
        </Field>
        <RoleBadge role={role} />
        <DialogButtons busy={busy} onClose={onClose} submitLabel="Create" />
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onDone,
  onError,
}: {
  user: UserView;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/reset-password`, { newPassword });
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Reset failed');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reset password — ${user.email}`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="New password">
          <input
            type="text"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputCls}
          />
        </Field>
        <p className="text-xs text-slate-500">This revokes all of the user’s active sessions.</p>
        <DialogButtons busy={busy} onClose={onClose} submitLabel="Reset password" />
      </form>
    </Modal>
  );
}

const inputCls =
  'mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function DialogButtons({
  busy,
  onClose,
  submitLabel,
}: {
  busy: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
    </div>
  );
}
