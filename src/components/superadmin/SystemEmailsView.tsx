'use client'

import React, { useCallback, useEffect, useState } from 'react'

type SystemEmailRow = {
  id: string
  createdAt: string
  recipient: string
  templateKey: string
  tenantId: string | null
  status: string
  providerId: string | null
  idempotencyKey: string
  errorMessage: string | null
  resendOfId: string | null
}

type TemplateSummary = {
  key: string
  sampleData: Record<string, string>
}

type PreviewResult = {
  subject: string
  html: string
  text: string
}

const formatSentAt = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(date)
}

export default function SystemEmailsView() {
  const [emails, setEmails] = useState<SystemEmailRow[]>([])
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [templateKey, setTemplateKey] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)

  const loadLog = useCallback(async () => {
    try {
      const response = await fetch('/api/superadmin/system-emails', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Could not load system emails.')
      }
      setEmails(Array.isArray(body.emails) ? body.emails : [])
      setTemplates(Array.isArray(body.templates) ? body.templates : [])
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load system emails.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // Fetch when the tab mounts. setState happens after the response, as in the other superadmin tabs.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- server log is not available during render
    void loadLog()
  }, [loadLog])

  const handleResend = async (logId: string) => {
    setResendingId(logId)
    setIsLoading(true)
    setNotice(null)
    setErrorMessage(null)
    try {
      const response = await fetch('/api/superadmin/system-emails/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logId,
          idempotencyKey: `resend:${logId}:${crypto.randomUUID()}`,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Could not resend that email.')
      }
      setNotice(body.duplicate ? 'That resend was already recorded.' : 'The email was resent.')
      await loadLog()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not resend that email.')
    } finally {
      setResendingId(null)
    }
  }

  const handlePreview = async () => {
    setIsPreviewing(true)
    setPreview(null)
    setErrorMessage(null)
    try {
      const response = await fetch('/api/superadmin/system-emails/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Could not preview that template.')
      }
      setPreview({ subject: body.subject, html: body.html, text: body.text })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not preview that template.')
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleTemplateKeyChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTemplateKey(event.target.value)
    setPreview(null)
  }

  return (
    <section className="space-y-6" aria-labelledby="system-emails-heading">
      <div>
        <h2 id="system-emails-heading" className="text-xl font-semibold text-white">System emails</h2>
        <p className="mt-1 text-sm text-gray-400">Log of StyleFlo system emails. Resend writes a new log row.</p>
      </div>

      {errorMessage ? (
        <p role="alert" className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-xl border border-emerald-800/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      <form
        className="rounded-2xl border border-gray-800 bg-gray-900 p-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void handlePreview()
        }}
      >
        <h3 className="text-sm font-semibold text-white">Preview a template</h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm text-gray-300" htmlFor="system-email-template">
            Template
            <select
              id="system-email-template"
              value={templateKey}
              onChange={handleTemplateKeyChange}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white"
            >
              <option value="">Choose a template</option>
              {templates.map((template) => (
                <option key={template.key} value={template.key}>{template.key}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!templateKey || isPreviewing}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPreviewing ? 'Previewing…' : 'Preview'}
          </button>
        </div>
        {templates.length === 0 && !isLoading ? (
          <p className="text-sm text-gray-400">No system email templates are registered.</p>
        ) : null}
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-200"><span className="text-gray-400">Subject: </span>{preview.subject}</p>
            <pre className="overflow-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-200 whitespace-pre-wrap">{preview.text}</pre>
            <iframe
              title="System email HTML preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-72 w-full rounded-lg bg-white"
            />
          </div>
        ) : null}
      </form>

      <div className="overflow-x-auto rounded-2xl border border-gray-800">
        <table className="w-full text-left text-sm text-gray-200">
          <caption className="sr-only">System email log</caption>
          <thead className="bg-gray-900 text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th scope="col" className="px-3 py-3">Time (London)</th>
              <th scope="col" className="px-3 py-3">Recipient</th>
              <th scope="col" className="px-3 py-3">Template</th>
              <th scope="col" className="px-3 py-3">Status</th>
              <th scope="col" className="px-3 py-3">Provider id</th>
              <th scope="col" className="px-3 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-gray-400">Loading system emails…</td>
              </tr>
            ) : null}
            {!isLoading && emails.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-gray-400">No system emails have been sent yet.</td>
              </tr>
            ) : null}
            {emails.map((email) => (
              <tr key={email.id} className="border-t border-gray-800">
                <td className="px-3 py-3 whitespace-nowrap">{formatSentAt(email.createdAt)}</td>
                <td className="px-3 py-3">{email.recipient}</td>
                <td className="px-3 py-3">{email.templateKey}</td>
                <td className="px-3 py-3">{email.status}</td>
                <td className="px-3 py-3 max-w-[12rem] truncate">{email.providerId || '—'}</td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => { void handleResend(email.id) }}
                    disabled={resendingId === email.id}
                    aria-label={`Resend email to ${email.recipient}`}
                    className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {resendingId === email.id ? 'Sending…' : 'Resend'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
