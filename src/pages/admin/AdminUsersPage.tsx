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
  const [form, setForm] = useState({ email: '', fullName: '', role: 'admin' as AdminRole })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [tempCredential, setTempCredential] = useState<{ email: string; password: string } | null>(null)

  const [pending, setPending] = useState<PendingChange | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [savingChange, setSavingChange] = useState(false)

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
    setCreating(true)
    try {
      const result = await adminUsers({
        action: 'create',
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        role: form.role,
      })
      setCreateOpen(false)
      const createdEmail = result.email ?? form.email.trim()
      setForm({ email: '', fullName: '', role: 'admin' })
      if (result.temp_password) {
        setTempCredential({ email: createdEmail, password: result.temp_password })
      } else {
        toast.success('Administrator created', 'The account was created.')
      }
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

  return (
    <div>
      <PageHeader
        title="Administrators"
        description="Accounts that can sign in to this dashboard."
        actions={
          !readOnly ? (
            <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
              Add administrator
            </Button>
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
        description="The account is created immediately with a one-time password you must share securely."
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
        </div>
      </Dialog>

      {/* One-time credential */}
      <Dialog
        open={tempCredential !== null}
        title="Administrator created"
        description="This password is shown only once. Share it with the account holder through a secure channel."
        onClose={() => setTempCredential(null)}
        footer={
          <Button variant="primary" onClick={() => setTempCredential(null)}>
            I have saved it
          </Button>
        }
      >
        {tempCredential && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Email</p>
              <p className="font-mono text-sm text-slate-900">{tempCredential.email}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">One-time password</p>
              <p className="select-all font-mono text-base font-semibold text-amber-900">{tempCredential.password}</p>
            </div>
            <p className="text-xs text-slate-500">
              The account holder should sign in and change this password. It cannot be retrieved again.
            </p>
          </div>
        )}
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
    </div>
  )
}
