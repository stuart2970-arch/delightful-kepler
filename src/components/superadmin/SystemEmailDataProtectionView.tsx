'use client'

import React, { useState } from 'react'

type NoticeResult = {
  dryRun?: boolean
  sent?: number
  duplicates?: number
  ticketTargetAt?: string | null
  solicitorTimingPending?: boolean
  loggedOnly?: boolean
  error?: string
}

const fieldClass = 'mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white'

export default function SystemEmailDataProtectionView() {
  const [incidentId, setIncidentId] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [awarenessAt, setAwarenessAt] = useState('')
  const [nature, setNature] = useState('')
  const [consequences, setConsequences] = useState('')
  const [measures, setMeasures] = useState('')
  const [contactName, setContactName] = useState('StyleFlo support')
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<NoticeResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const submit = async (dryRun: boolean) => {
    const id = incidentId.trim() || crypto.randomUUID()
    if (id !== incidentId) setIncidentId(id)
    setIsBusy(true)
    setErrorMessage(null)
    setResult(null)
    try {
      const response = await fetch('/api/superadmin/system-emails/notices/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: id,
          kind: 'salon',
          tenantId,
          awarenessAt,
          nature,
          consequences,
          measures,
          contactName,
          peopleAffected: '',
          recordsAffected: '',
          dryRun,
          confirm: !dryRun,
        }),
      })
      const body = await response.json().catch(() => ({})) as NoticeResult
      if (!response.ok) throw new Error(body.error || 'The incident notice could not be prepared.')
      setResult(body)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The incident notice could not be prepared.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="data-protection-heading">
      <div>
        <h2 id="data-protection-heading" className="text-xl font-semibold text-white">Data protection notices</h2>
        <p className="mt-1 text-sm text-gray-400">
          Salon breach notice. A dry run sends nothing. The 72-hour figure is the ticket target only. Solicitor confirmation of the legal timing is still pending. Sending stays off until batch 3 is switched on.
        </p>
      </div>
      {errorMessage ? (
        <p role="alert" className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">{errorMessage}</p>
      ) : null}
      <form
        className="space-y-3 rounded-2xl border border-gray-800 bg-gray-900 p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit(true)
        }}
      >
        <label className="block text-sm text-gray-300" htmlFor="breach-tenant">
          Account id
          <input id="breach-tenant" value={tenantId} onChange={(event) => setTenantId(event.target.value)} required className={fieldClass} />
        </label>
        <label className="block text-sm text-gray-300" htmlFor="breach-aware">
          Date we became aware
          <input id="breach-aware" value={awarenessAt} onChange={(event) => setAwarenessAt(event.target.value)} required className={fieldClass} />
        </label>
        <label className="block text-sm text-gray-300" htmlFor="breach-nature">
          What happened
          <textarea id="breach-nature" value={nature} onChange={(event) => setNature(event.target.value)} required className={fieldClass} />
        </label>
        <label className="block text-sm text-gray-300" htmlFor="breach-consequences">
          Likely consequences
          <textarea id="breach-consequences" value={consequences} onChange={(event) => setConsequences(event.target.value)} required className={fieldClass} />
        </label>
        <label className="block text-sm text-gray-300" htmlFor="breach-measures">
          Measures
          <textarea id="breach-measures" value={measures} onChange={(event) => setMeasures(event.target.value)} required className={fieldClass} />
        </label>
        <label className="block text-sm text-gray-300" htmlFor="breach-contact">
          Contact
          <input id="breach-contact" value={contactName} onChange={(event) => setContactName(event.target.value)} required className={fieldClass} />
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-300" htmlFor="breach-confirm">
          <input id="breach-confirm" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
          <span>I confirm this breach notice should be sent to the account. A dry run does not send.</span>
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={isBusy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {isBusy ? 'Working…' : 'Dry run'}
          </button>
          <button
            type="button"
            disabled={!confirmed || isBusy}
            onClick={() => { void submit(false) }}
            className="rounded-lg border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-50"
          >
            Send salon breach notice
          </button>
        </div>
      </form>
      {result?.dryRun ? (
        <p role="status" className="text-sm text-gray-200">
          {`Dry run. Nothing was sent. Ticket target: ${result.ticketTargetAt || 'not set'}. Solicitor timing is still pending.`}
        </p>
      ) : null}
      {result && result.dryRun === false ? (
        <p role="status" className="text-sm text-gray-200">
          {`Sent ${result.sent ?? 0}. Already sent ${result.duplicates ?? 0}.`}
        </p>
      ) : null}
    </section>
  )
}
