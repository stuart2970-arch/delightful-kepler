'use client'

import React, { useCallback, useEffect, useState } from 'react'

type RetentionResponse = {
  accountRecordRetentionDays: number
  messageRetentionDays: number
  accountRecordRetentionMaximumDays: number
  messageRetentionMaximumDays: number
  error?: string
}

export default function RetentionPeriodCard() {
  const [accountDays, setAccountDays] = useState('365')
  const [messageDays, setMessageDays] = useState('90')
  const [maximumAccount, setMaximumAccount] = useState(365)
  const [maximumMessage, setMaximumMessage] = useState(90)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const loadRetention = useCallback(async () => {
    try {
      const response = await fetch('/api/account/retention', { cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as RetentionResponse
      if (!response.ok) throw new Error(body.error || 'Could not load retention settings.')
      setAccountDays(String(body.accountRecordRetentionDays))
      setMessageDays(String(body.messageRetentionDays))
      setMaximumAccount(body.accountRecordRetentionMaximumDays)
      setMaximumMessage(body.messageRetentionMaximumDays)
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load retention settings.')
    }
  }, [])

  useEffect(() => {
    // The saved periods come from the account. setState runs after the response.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- retention is not available during render
    void loadRetention()
  }, [loadRetention])

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    setNotice(null)
    setErrorMessage(null)
    try {
      const response = await fetch('/api/account/retention', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountRecordRetentionDays: Number(accountDays),
          messageRetentionDays: Number(messageDays),
        }),
      })
      const body = await response.json().catch(() => ({})) as RetentionResponse
      if (!response.ok) throw new Error(body.error || 'Retention could not be saved.')
      setAccountDays(String(body.accountRecordRetentionDays))
      setMessageDays(String(body.messageRetentionDays))
      setNotice('Retention periods saved. They can be shortened again, not lengthened.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Retention could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSave(event) }}
      className="bg-white border border-[#f2f3f5] p-6 rounded-xl space-y-4 shadow-sm"
      aria-labelledby="retention-period-heading"
    >
      <div>
        <h4 id="retention-period-heading" className="text-base font-extrabold text-[#260475] tracking-tight">
          How long we keep data
        </h4>
        <p className="text-[11px] text-gray-500 font-medium mt-1">
          {`Account records start at 12 months (${maximumAccount} days). Messages start at ${maximumMessage} days. You can shorten either period. You cannot lengthen it.`}
        </p>
      </div>
      {errorMessage ? (
        <p role="alert" className="text-sm text-red-700">{errorMessage}</p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-emerald-700">{notice}</p>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-xs font-semibold text-[#212326]" htmlFor="account-record-retention-days">
          Account records (days)
          <input
            id="account-record-retention-days"
            type="number"
            min={1}
            max={maximumAccount}
            value={accountDays}
            onChange={(event) => setAccountDays(event.target.value)}
            className="mt-1.5 w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326]"
          />
        </label>
        <label className="block text-xs font-semibold text-[#212326]" htmlFor="message-retention-days">
          Messages (days)
          <input
            id="message-retention-days"
            type="number"
            min={1}
            max={maximumMessage}
            value={messageDays}
            onChange={(event) => setMessageDays(event.target.value)}
            className="mt-1.5 w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326]"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={isSaving}
        className="rounded-lg bg-[#260475] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isSaving ? 'Saving…' : 'Save shorter periods'}
      </button>
    </form>
  )
}
