# Batch 1 previews — closure reminder and deletion confirmation (STYL-276)

Rendered from the registered templates. These are sample facts, not a live send.
The daily sweep sends them only when `FAILED_PAYMENT_FLOW_ENABLED` is exactly `true`.
Reply-To is support@styleflo.ai. Each send is stored in `system_email_log` and is not repeated.
The deletion-day confirmation is separate from `system.batch3.deletion-confirmation`, which is the letter sent when someone asks for written confirmation.

## system.batch1.closure-reminder

### Subject

Your StyleFlo data will be deleted on 1 February 2026

### Text

```
Hello,

The StyleFlo account for Harbour Salon closed on 1 January 2026.

We will delete the account data on 1 February 2026. On the same day we will release the StyleFlo number 01632 960123.

You can reopen the account before that date. Reopening keeps the data and the number.

We may keep billing records for as long as the law requires.

Reply to this email and it will reach StyleFlo support.
```

### Data-only text

```
Hello,

The StyleFlo account for Harbour Salon closed on 1 January 2026.

We will delete the account data on 1 February 2026. This account has no StyleFlo number to release.

You can reopen the account before that date. Reopening keeps the data.

We may keep billing records for as long as the law requires.

Reply to this email and it will reach StyleFlo support.
```

## system.batch1.closure-deleted

### Subject

Your StyleFlo account data has been deleted

### Text

```
Hello,

We have deleted the account data for Harbour Salon. We have released the StyleFlo number 01632 960123.

This was done on 1 February 2026.

We may keep billing records for as long as the law requires.

Reply to this email and it will reach StyleFlo support.
```

### Data-only text

```
Hello,

We have deleted the account data for Harbour Salon. This account had no StyleFlo number to release.

This was done on 1 February 2026.

We may keep billing records for as long as the law requires.

Reply to this email and it will reach StyleFlo support.
```
