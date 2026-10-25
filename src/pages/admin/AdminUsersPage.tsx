import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Card, EmptyState, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { Table, TableWrap, Td, Th } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { ApiError, adminUsers } from '@/lib/api'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useToast } from '@/context/ToastContext'
import { formatDateTime, titleCase } from '@/lib/format'
import type { AdminRole, AdminUserRow } from '@/lib/types'

/** Minimum password length for administrator accounts (mirrors the server). */
const MIN_PASSWORD_LENGTH = 12

function roleTone(role: AdminRole): 'accent' | 'info' | 'neutral' {
  if (role === 'owner') return 'accent'
  if (role === 'admin') return 'info'
  return 'neutral'
}

interface PendingChange {
  user: AdminUserRow
  role: AdminRole
  isActive: boolean
}

/**
 * Administrator accounts. There is no public sign-up: the first owner is
 * created by admin-bootstrap, and every other account is created here by an
 * existing owner or admin.
 */
export function AdminUsersPage() {
  const toast = useToast()
  const { admin: currentAdmin } = useAdminAuth()
  const readOnly = currentAdmin?.role === 'viewer'

  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    role: 'admin' as AdminRole,
    password: '',
    confirmPassword: '',
  })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [pending, setPending] = useState<PendingChange | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [savingChange, setSavingChange] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await adminUsers({ action: 'list' })
      setRows(result.rows ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load administrators.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submitCreate = async () => {
    setFormError(null)
    if (!form.email.trim()) {
      setFormError('Please enter the administrator’s email address.')
      return
    }
    // The same rules the server applies, so the mistake is caught before the
    // request rather than after.
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`)
      return
    }
    if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      setFormError('The password must contain both letters and numbers.')
      return
    }
    if (form.password !== form.confirmPassword) {
      setFormError('The two passwords do not match.')
      return
    }
    setCreating(true)
    try {
      const email = form.email.trim()
      await adminUsers({
        action: 'create',
        email,
        fullName: form.fullName.trim(),
        role: form.role,
        password: form.password,
      })
      setCreateOpen(false)
      setForm({ email: '', fullName: '', role: 'admin', password: '', confirmPassword: '' })
      toast.success(
        'Administrator created',
        `${email} can now sign in with the password you chose. Share it with them securely.`,
      )
      await load()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create the administrator.')
    } finally {
      setCreating(false)
    }
  }

  const commitChange = async () => {
    if (!pending) return
    setSavingChange(true)
    try {
      await adminUsers({ action: 'update', userId: pending.user.id, role: pending.role, isActive: pending.isActive })
      toast.success('Administrator updated')
      setPending(null)
      setConfirming(false)
      await load()
    } catch (err) {
      toast.error('Could not update administrator', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setSavingChange(false)
    }
  }

  const changeHappens =
    pending && (pending.role !== pending.user.role || pending.isActive !== pending.user.is_active)

  /** Disabled accounts eligible for permanent deletion (owners only by an owner). */
  const inactiveRows = rows.filter(
    (user) =>
      !user.is_active &&
      user.id !== currentAdmin?.id &&
      (currentAdmin?.role === 'owner' || user.role !== 'owner'),
  )

  const commitDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await adminUsers({ action: 'delete', userId: deleteTarget.id })
      toast.success('Administrator deleted', `${deleteTarget.email} can no longer sign in.`)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error('Could not delete administrator', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  const commitBulkDelete = async () => {
    setBulkDeleting(true)
    try {
      const result = await adminUsers({ action: 'delete_inactive' })
      const deleted = result.deleted ?? 0
      const skipped = result.skipped ?? 0
      toast.success(
        'Inactive administrators deleted',
        skipped > 0
          ? `${deleted} account(s) removed; ${skipped} skipped (owner accounts need an owner to delete them).`
          : `${deleted} account(s) removed permanently.`,
      )
      setBulkOpen(false)
      await load()
    } catch (err) {
      toast.error('Could not delete inactive administrators', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Administrators"
        actions={
          !readOnly ? (
            <div className="flex flex-wrap items-center gap-2">
              {inactiveRows.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
                  Delete inactive ({inactiveRows.length})
                </Button>
              )}
              <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
                Add administrator
              </Button>
            </div>
          ) : undefined
        }
      />

      {readOnly && (
        <Alert tone="info" className="mb-5">
          You are signed in with a read-only (viewer) account. Administrator management is disabled.
        </Alert>
      )}

      {error && (
        <Alert tone="danger" title="Could not load administrators" className="mb-5">
          {error}
        </Alert>
      )}

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner label="Loading administrators" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No administrators" description="No administrator accounts were found." />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Added</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <tr key={user.id}>
                    <Td className="font-medium text-slate-900">
                      {user.full_name || '—'}
                      {user.id === currentAdmin?.id && (
                        <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>
                      )}
                    </Td>
                    <Td className="text-slate-700">{user.email}</Td>
                    <Td>
                      <Badge tone={roleTone(user.role)}>{titleCase(user.role)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={user.is_active ? 'success' : 'neutral'}>
                        {user.is_active ? 'Active' : 'Disabled'}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-slate-600">{formatDateTime(user.created_at)}</Td>
                    <Td>
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPending({ user, role: user.role, isActive: user.is_active })}
                        >
                          Manage
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {/* Create */}
      <Dialog
        open={createOpen}
        title="Add administrator"
        description="Set an initial password for the account and share it with them securely. They can sign in with it straight away."
        onClose={() => {
          setCreateOpen(false)
          setFormError(null)
        }}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button variant="accent" loading={creating} onClick={() => void submitCreate()}>
              Create account
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="Email address" htmlFor="user-email" required>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="name@organisation.org"
            />
          </Field>
          <Field label="Full name" htmlFor="user-name" hint="Optional">
            <Input
              id="user-name"
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
            />
          </Field>
          <Field label="Role" htmlFor="user-role" hint="Viewers can see data but cannot change anything.">
            <Select
              id="user-role"
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value as AdminRole })}
            >
              <option value="admin">Admin — manage registrations, payments and championships</option>
              <option value="viewer">Viewer — read-only access</option>
              {currentAdmin?.role === 'owner' && <option value="owner">Owner — full access including owners</option>}
            </Select>
          </Field>
          <Field
            label="Password"
            htmlFor="user-password"
            required
            hint={`At least ${MIN_PASSWORD_LENGTH} characters, with letters and numbers.`}
          >
            <Input
              id="user-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </Field>
          <Field label="Confirm password" htmlFor="user-password-confirm" required>
            <Input
              id="user-password-confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
            />
          </Field>
        </div>
      </Dialog>

      {/* Manage */}
      <Dialog
        open={pending !== null}
        title={pending ? `Manage ${pending.user.full_name || pending.user.email}` : ''}
        onClose={() => {
          setPending(null)
          setConfirming(false)
        }}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setPending(null)
                setConfirming(false)
              }}
              disabled={savingChange}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              disabled={!changeHappens}
              onClick={() => setConfirming(true)}
            >
              Save changes
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-4">
            <Field label="Role" htmlFor="manage-role">
              <Select
                id="manage-role"
                value={pending.role}
                onChange={(event) => setPending({ ...pending, role: event.target.value as AdminRole })}
              >
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
                {currentAdmin?.role === 'owner' && <option value="owner">Owner</option>}
              </Select>
            </Field>
            <div className="rounded-lg border border-slate-200 p-3">
              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                  checked={pending.isActive}
                  onChange={(event) => setPending({ ...pending, isActive: event.target.checked })}
                />
                <span>
                  Account active
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Disabling prevents sign-in without deleting any data. The last active owner cannot be disabled.
                  </span>
                </span>
              </label>
            </div>
            {pending.role !== 'owner' && pending.user.role === 'owner' && (
              <Alert tone="warning">
                Changing this owner to another role may leave the organisation without an owner. The server will refuse
                if it would be the last one.
              </Alert>
            )}
            {!pending.user.is_active &&
              pending.user.id !== currentAdmin?.id &&
              (currentAdmin?.role === 'owner' || pending.user.role !== 'owner') && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-medium text-red-800">Delete this account</p>
                  <p className="mt-1 text-xs text-red-700">
                    This account is disabled. Deleting removes it permanently and it can never sign in again. Audit
                    history is kept.
                  </p>
                  <Button
                    variant="danger"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setDeleteTarget(pending.user)
                      setPending(null)
                      setConfirming(false)
                    }}
                  >
                    Delete account
                  </Button>
                </div>
              )}
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirming}
        title="Save these changes?"
        description="Role and access changes take effect immediately and are written to the audit trail."
        confirmLabel="Save changes"
        loading={savingChange}
        onClose={() => setConfirming(false)}
        onConfirm={() => void commitChange()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this administrator?"
        description={
          deleteTarget
            ? `${deleteTarget.email} will be removed permanently and can never sign in again. Audit history is kept.`
            : undefined
        }
        confirmLabel="Delete account"
        tone="danger"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void commitDelete()}
      />

      <ConfirmDialog
        open={bulkOpen}
        title="Delete all inactive administrators?"
        description={`${inactiveRows.length} disabled account(s) will be removed permanently and can never sign in again. Audit history is kept.`}
        confirmLabel="Delete inactive accounts"
        tone="danger"
        loading={bulkDeleting}
        onClose={() => setBulkOpen(false)}
        onConfirm={() => void commitBulkDelete()}
      />
    </div>
  )
}
