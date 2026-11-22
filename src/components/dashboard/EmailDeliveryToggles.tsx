'use client'

import React, { useEffect, useState } from 'react'

type ToggleState = {
  enquiryDetailsEmailEnabled: boolean
  bookingConfirmationEmailEnabled: boolean
}

type EmailDeliveryTogglesProps = {
  accountEmail: string
}

const EmailDeliveryToggles = ({ accountEmail }: EmailDeliveryTogglesProps) => {
  const [toggles, setToggles] = useState<ToggleState>({
    enquiryDetailsEmailEnabled: true,
    bookingConfirmationEmailEnabled: true,
  })
  const [statusText, setStatusText] = useState('')
  const [savingKey, setSavingKey] = useState<keyof ToggleState | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadToggles = async () => {
      try {
        const response = await fetch('/api/account/email-toggles')
        if (!response.ok) return
        const body = await response.json()
        if (cancelled) return
        setToggles({
          enquiryDetailsEmailEnabled: body.enquiryDetailsEmailEnabled !== false,
          bookingConfirmationEmailEnabled: body.bookingConfirmationEmailEnabled !== false,
        })
      } catch {
        if (!cancelled) setStatusText('Email settings could not be loaded. Both stay on until you change them.')
      }
    }
    void loadToggles()
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = async (key: keyof ToggleState) => {
    const next = !toggles[key]
    setSavingKey(key)
    setStatusText('')
    setToggles((current) => ({ ...current, [key]: next }))
    try {
      const response = await fetch('/api/account/email-toggles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      })
      if (!response.ok) {
        setToggles((current) => ({ ...current, [key]: !next }))
        setStatusText('That change could not be saved.')
        return
      }
      const body = await response.json()
      setToggles({
        enquiryDetailsEmailEnabled: body.enquiryDetailsEmailEnabled !== false,
        bookingConfirmationEmailEnabled: body.bookingConfirmationEmailEnabled !== false,
      })
      setStatusText('Saved.')
    } catch {
      setToggles((current) => ({ ...current, [key]: !next }))
      setStatusText('That change could not be saved.')
    } finally {
      setSavingKey(null)
    }
  }

  const handleToggleKeyDown = (key: keyof ToggleState) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    void handleToggle(key)
  }

  return (
    <div className="bg-white border border-[#f2f3f5] p-6 rounded-xl space-y-4 shadow-sm" data-testid="email-delivery-toggles">
      <div>
        <h4 className="text-base font-extrabold text-[#260475] tracking-tight">Email delivery</h4>
        <p className="text-[11px] text-gray-500 font-medium">Both emails are on unless you turn them off.</p>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-[#212326] mb-1.5" htmlFor="dashboard-address">
            Dashboard address
          </label>
          <input
            id="dashboard-address"
            data-testid="dashboard-address"
            type="email"
            value={accountEmail}
            readOnly
            className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-semibold"
          />
          <p className="text-[10px] text-[#434549] mt-1">
            Enquiry details go to the address on each assistant, or to this account email when that address is blank.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={toggles.enquiryDetailsEmailEnabled}
          aria-label="Enquiry details email"
          data-testid="enquiry-details-email-toggle"
          tabIndex={0}
          disabled={savingKey === 'enquiryDetailsEmailEnabled'}
          onClick={() => { void handleToggle('enquiryDetailsEmailEnabled') }}
          onKeyDown={handleToggleKeyDown('enquiryDetailsEmailEnabled')}
          className={`h-[50px] shrink-0 rounded-lg px-4 text-xs font-bold border ${toggles.enquiryDetailsEmailEnabled ? 'bg-[#260475] text-white border-[#260475]' : 'bg-white text-[#212326] border-[#f2f3f5]'}`}
        >
          {toggles.enquiryDetailsEmailEnabled ? 'Enquiry emails on' : 'Enquiry emails off'}
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[#f2f3f5] pt-3">
        <p className="text-xs text-[#212326]">Booking confirmation to your customer</p>
        <button
          type="button"
          role="switch"
          aria-checked={toggles.bookingConfirmationEmailEnabled}
          aria-label="Booking confirmation email"
          data-testid="booking-confirmation-email-toggle"
          tabIndex={0}
          disabled={savingKey === 'bookingConfirmationEmailEnabled'}
          onClick={() => { void handleToggle('bookingConfirmationEmailEnabled') }}
          onKeyDown={handleToggleKeyDown('bookingConfirmationEmailEnabled')}
          className={`h-10 shrink-0 rounded-lg px-4 text-xs font-bold border ${toggles.bookingConfirmationEmailEnabled ? 'bg-[#260475] text-white border-[#260475]' : 'bg-white text-[#212326] border-[#f2f3f5]'}`}
        >
          {toggles.bookingConfirmationEmailEnabled ? 'On' : 'Off'}
        </button>
      </div>
      {statusText ? <p className="text-xs text-[#434549]" role="status">{statusText}</p> : null}
    </div>
  )
}

export default EmailDeliveryToggles
