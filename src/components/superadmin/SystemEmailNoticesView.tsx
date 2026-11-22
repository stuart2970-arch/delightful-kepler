'use client'

import React, { useCallback, useEffect, useState } from 'react'

type NoticeField = {
  name: string
  label: string
  required: boolean
}

type NoticeDefinition = {
  number: number
  key: string
  label: string
  fields: NoticeField[]
}

type RecipientRow = {
  tenantId: string
  businessName: string
  email: string
}

type NoticeResponse = {
  dryRun?: boolean
  enabled?: boolean
  sent?: number
  duplicates?: number
  failed?: number
  recipients?: RecipientRow[]
  error?: string
}

const newNoticeId = (): string => crypto.randomUUID()

export default function SystemEmailNoticesView() {
  const [notices, setNotices] = useState<NoticeDefinition[]>([])
  const [templateKey, setTemplateKey] = useState('')
  const [noticeId, setNoticeId] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [result, setResult] = useState<NoticeResponse | null>(null)

  const loadNotices = useCallback(async () => {
    try {
      const response = await fetch('/api/superadmin/system-emails/notices', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not load notices.')
      const loaded = Array.isArray(body.notices) ? body.notices as NoticeDefinition[] : []
      setNotices(loaded)
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load notices.')
    }
  }, [])

  useEffect(() => {
    // The catalogue comes from the server. setState runs after the response.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- notice catalogue is not available during render
    void loadNotices()
  }, [loadNotices])

  const selected = notices.find((notice) => notice.key === templateKey) ?? null

  const handleTemplateChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTemplateKey(event.target.value)
    setFields({})
    setConfirmed(false)
    setResult(null)
  }

  const handleFieldChange = (name: string, value: string) => {
    setFields((current) => ({ ...current, [name]: value }))
  }

  const submit = async (dryRun: boolean) => {
    const id = noticeId.trim() || newNoticeId()
    if (id !== noticeId) setNoticeId(id)
    setIsBusy(true)
    setErrorMessage(null)
    setResult(null)
    try {
      const response = await fetch('/api/superadmin/system-emails/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noticeId: id,
          templateKey,
          data: fields,
          dryRun,
          confirm: !dryRun,
        }),
      })
      const body = await response.json().catch(() => ({})) as NoticeResponse
      if (!response.ok) {
        throw new Error(body.error || 'The notice could not be prepared.')
      }
      setResult(body)
      if (!dryRun) setNoticeId(newNoticeId())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The notice could not be prepared.')
    } finally {
      setIsBusy(false)
    }
  }

  const handleDryRun = () => {
    void submit(true)
  }

  const handleConfirm = () => {
    if (!confirmed) return
    void submit(false)
  }

  return (
    <section className="space-y-4" aria-labelledby="legal-notices-heading">
      <div>
        <h2 id="legal-notices-heading" className="text-xl font-semibold text-white">Legal notices</h2>
        <p className="mt-1 text-sm text-gray-400">
          Sends one notice to every active account. A dry run lists recipients and sends nothing.
          Sending stays off until batch 3 is switched on. The same notice id is never sent twice.
        </p>
      </div>

      {errorMessage ? (
        <p role="alert" className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </p>
      ) : null}

      <form
        className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-4"
        onSubmit={(event) => {
          event.preventDefault()
          handleDryRun()
        }}
      >
        <label className="block text-sm text-gray-300" htmlFor="legal-notice-template">
          Notice
          <select
            id="legal-notice-template"
            value={templateKey}
            onChange={handleTemplateChange}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white"
          >
            <option value="">Choose a notice</option>
            {notices.map((notice) => (
              <option key={notice.key} value={notice.key}>
                {`#${notice.number} ${notice.label}`}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-gray-300" htmlFor="legal-notice-id">
          Notice id
          <input
            id="legal-notice-id"
            value={noticeId}
            onChange={(event) => setNoticeId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-white"
            autoComplete="off"
          />
        </label>

        {selected?.fields.map((field) => (
          <label key={field.name} className="block text-sm text-gray-300" htmlFor={`legal-notice-${field.name}`}>
            {field.label}
            <input
              id={`legal-notice-${field.name}`}
              value={fields[field.name] || ''}
              onChange={(event) => handleFieldChange(field.name, event.target.value)}
              required={field.required}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white"
            />
          </label>
        ))}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={!templateKey || isBusy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? 'Working…' : 'Dry run'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!templateKey || !confirmed || isBusy}
            className="rounded-lg border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send to all affected accounts
          </button>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-300" htmlFor="legal-notice-confirm">
          <input
            id="legal-notice-confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>I confirm this notice should be sent to every affected account. A dry run does not send.</span>
        </label>
      </form>

      {result?.dryRun ? (
        <div className="space-y-2" role="status">
          <p className="text-sm text-gray-200">
            {`Dry run. ${result.recipients?.length ?? 0} account${result.recipients?.length === 1 ? '' : 's'}. Nothing was sent.`}
            {result.enabled ? ' Batch 3 sending is on.' : ' Batch 3 sending is off.'}
          </p>
          <ul className="space-y-1 text-sm text-gray-300">
            {(result.recipients ?? []).map((recipient) => (
              <li key={recipient.tenantId}>
                {`${recipient.businessName} — ${recipient.email}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result && result.dryRun === false ? (
        <p role="status" className="text-sm text-gray-200">
          {`Sent ${result.sent ?? 0}. Already sent ${result.duplicates ?? 0}. Not sent ${result.failed ?? 0}.`}
        </p>
      ) : null}
    </section>
  )
}
