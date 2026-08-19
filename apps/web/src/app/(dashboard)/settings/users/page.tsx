'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { RoleBadge } from '@/components/role-badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { api, ApiError } from '@/lib/api';
import { ROLES, ROLE_LABELS, ROLE_HINTS, type Role, type UserView } from '@/lib/types';
import type { Platform } from '@/lib/domain-types';

/** Minimal account shape from GET /accounts for the grant picker. */
interface AccountOption {
  id: string;
  name: string;
  handle: string | null;
  platform: Platform;
}

function isGrantScoped(role: Role): boolean {
  return role !== 'OWNER' && role !== 'ADMIN';
}

export default function UsersSettingsPage() {
  const toast = useToast();
  const [users, setUsers] = useState<UserView[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetFor, setResetFor] = useState<UserView | null>(null);
  const [accountsFor, setAccountsFor] = useState<UserView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userRows, accountRows] = await Promise.all([
        api.get<UserView[]>('/users'),
        api.get<AccountOption[]>('/accounts'),
      ]);
      setUsers(userRows);
      setAccounts(accountRows);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    try { await fn(); await load(); }
    catch (err) { toast(err instanceof ApiError ? err.message : 'Action failed', 'error'); }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-500">
          Team members with access to this workspace. Owners and Admins see all accounts;
          Reviewers only see accounts you grant them.
        </p>
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          + New user
        </Button>
      </div>

      <Card>
        <Table className="rounded-t-none border-0">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Accounts</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {loading && (
              <TR>
                <TD className="text-center text-zinc-500">Loading…</TD>
                <TD /><TD /><TD /><TD /><TD />
              </TR>
            )}
            {!loading && users.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium text-zinc-900">{u.name ?? '—'}</TD>
                <TD className="text-zinc-500">{u.email}</TD>
                <TD>
                  <Select
                    value={u.role}
                    onChange={(e) => act(() => api.patch(`/users/${u.id}/role`, { role: e.target.value as Role }))}
                    className="w-auto py-1 text-xs"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </TD>
                <TD>
                  {u.allAccountsAccess ? (
                    <span className="text-xs text-zinc-500">All accounts</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAccountsFor(u)}
                      className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50"
                    >
                      {u.accountIds.length === 0
                        ? 'No accounts'
                        : `${u.accountIds.length} account${u.accountIds.length === 1 ? '' : 's'}`}
                    </button>
                  )}
                </TD>
                <TD>
                  <Badge tone={u.status === 'ACTIVE' ? 'green' : 'amber'}>{u.status}</Badge>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {isGrantScoped(u.role) && (
                      <button
                        type="button"
                        onClick={() => setAccountsFor(u)}
                        className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50"
                      >
                        Accounts
                      </button>
                    )}
                    <button type="button" onClick={() => setResetFor(u)}
                      className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50">
                      Reset pw
                    </button>
                    {u.status === 'ACTIVE' ? (
                      <button type="button" onClick={() => act(() => api.patch(`/users/${u.id}/disable`))}
                        className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50">
                        Disable
                      </button>
                    ) : (
                      <button type="button" onClick={() => act(() => api.patch(`/users/${u.id}/enable`))}
                        className="rounded border border-green-200 px-2 py-0.5 text-xs text-green-700 hover:bg-green-50">
                        Enable
                      </button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {showCreate && (
        <CreateUserDialog
          accounts={accounts}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load(); }}
          onError={(m) => toast(m, 'error')}
        />
      )}
      {resetFor && (
        <ResetPasswordDialog
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => { setResetFor(null); toast('Password reset', 'success'); }}
          onError={(m) => toast(m, 'error')}
        />
      )}
      {accountsFor && (
        <AccountAccessDialog
          user={accountsFor}
          accounts={accounts}
          onClose={() => setAccountsFor(null)}
          onSaved={() => { setAccountsFor(null); void load(); toast('Account access saved', 'success'); }}
          onError={(m) => toast(m, 'error')}
        />
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4">
      <div
        className={`w-full rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl ${
          wide ? 'max-w-lg' : 'max-w-md'
        }`}
      >
        <h3 className="mb-4 text-base font-semibold text-zinc-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function AccountCheckboxList({
  accounts,
  selected,
  onChange,
  disabled,
}: {
  accounts: AccountOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  if (accounts.length === 0) {
    return <p className="text-xs text-zinc-500">No connected accounts yet.</p>;
  }

  return (
    <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2">
      {accounts.map((a) => {
        const checked = selected.has(a.id);
        return (
          <li key={a.id}>
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50 ${
                disabled ? 'cursor-not-allowed opacity-60' : ''
              }`}
            >
              <input
                type="checkbox"
                className="rounded border-zinc-300"
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  const next = new Set(selected);
                  if (checked) next.delete(a.id);
                  else next.add(a.id);
                  onChange(next);
                }}
              />
              <PlatformIcon platform={a.platform} size={16} />
              <span className="min-w-0 truncate font-medium text-zinc-900">{a.name}</span>
              {a.handle && (
                <span className="truncate text-xs text-zinc-500">@{a.handle.replace(/^@/, '')}</span>
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function CreateUserDialog({
  accounts, onClose, onCreated, onError,
}: {
  accounts: AccountOption[];
  onClose: () => void;
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('REVIEWER');
  const [tempPassword, setTempPassword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const grantScoped = isGrantScoped(role);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/users', {
        email,
        name: name || undefined,
        role,
        tempPassword,
        ...(grantScoped ? { accountIds: [...selected] } : {}),
      });
      onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Create failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="Create user" wide>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Name (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-zinc-500">{ROLE_HINTS[role]}</p>
        </Field>
        <Field label="Temporary password">
          <Input type="text" required minLength={8} value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
        </Field>
        <RoleBadge role={role} />
        {grantScoped ? (
          <Field label="Account access">
            <AccountCheckboxList accounts={accounts} selected={selected} onChange={setSelected} />
            <p className="mt-1.5 text-xs text-zinc-500">
              Leave empty for no account access. They will only see the accounts you select.
            </p>
          </Field>
        ) : (
          <p className="text-xs text-zinc-500">
            Owners and Admins automatically see all connected accounts.
          </p>
        )}
        <DialogButtons busy={busy} onClose={onClose} submitLabel="Create" />
      </form>
    </Modal>
  );
}

function AccountAccessDialog({
  user, accounts, onClose, onSaved, onError,
}: {
  user: UserView;
  accounts: AccountOption[];
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const liveIds = new Set(accounts.map((a) => a.id));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(user.accountIds.filter((id) => liveIds.has(id))),
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put(`/users/${user.id}/accounts`, { accountIds: [...selected] });
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Account access — ${user.email}`} wide>
      <form onSubmit={submit} className="space-y-3">
        {user.allAccountsAccess ? (
          <p className="text-sm text-zinc-600">
            This user is an Owner or Admin and can access every account. Grants below are stored
            but not enforced until their role is changed to Reviewer.
          </p>
        ) : (
          <p className="text-sm text-zinc-600">
            Select which social accounts this user can see and operate on. Leave empty for no
            account access.
          </p>
        )}
        <AccountCheckboxList accounts={accounts} selected={selected} onChange={setSelected} />
        <DialogButtons busy={busy} onClose={onClose} submitLabel="Save access" />
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({
  user, onClose, onDone, onError,
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
          <Input type="text" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
        <p className="text-xs text-zinc-500">This revokes all of the user&rsquo;s active sessions.</p>
        <DialogButtons busy={busy} onClose={onClose} submitLabel="Reset password" />
      </form>
    </Modal>
  );
}

function DialogButtons({ busy, onClose, submitLabel }: { busy: boolean; onClose: () => void; submitLabel: string }) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button type="button" size="sm" onClick={onClose}>Cancel</Button>
      <Button type="submit" variant="primary" size="sm" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </div>
  );
}
