# STYL-265 batch 4 previews (part A)

Rendered for review. No live send. British English. `#41` and `#45` keep their existing bodies. The business can turn either off. Both default on. Auth emails `#42`–`#44` are Supabase Auth template files. Hosted SMTP is not configured in this repository.

## #41 Enquiry details

Subject: `[New Lead] Appointment & Booking Enquiry captured by Harbour Bot`

From: the assistant name, unchanged.

Plain text:

```
==================================================
NEW LEAD CAPTURED BY AI CHATBOT
==================================================
Business: Harbour Salon
Chatbot: Harbour Bot
Channel: Web Chat
Date & Time: (sent at the time of the enquiry, Europe/London)
Customer Name: Alex

--------------------------------------------------
CONSOLIDATED CONTACT DETAILS:
- Email Address: alex@example.test
- Mobile / Telephone: Not provided yet
--------------------------------------------------
CUSTOMER INTENT:
- Category: Appointment & Booking Enquiry
- Primary Enquiry: "Please book a trim next Friday."
--------------------------------------------------
--- CHAT TRANSCRIPT ---
Customer: Please book a trim next Friday.
--------------------------------------------------
Log into your StyleFlo Dashboard to view and manage this conversation.
==================================================
```

HTML uses the existing branded lead layout (`New Lead Captured`, contact table, intent, transcript, dashboard link). Turning the control off sends nothing and does not mark the conversation as already emailed.

## #45 Booking confirmation

From: `"Harbour Salon" via StyleFlo <no-reply@MAILGUN_DOMAIN>`

Subject: `Booking Confirmed: Cut with Sam`

Plain text:

```
Hi Alex,

Your appointment for Cut with Sam is confirmed for 22 November 2026, 10:00.

To cancel or reschedule, please contact the small business directly.

Thank you for booking with Harbour Salon.
```

HTML:

```html
<p>Hi Alex,</p>
<p>Your appointment for <strong>Cut</strong> with <strong>Sam</strong> is confirmed for <strong>22 November 2026, 10:00</strong>.</p>
<p>To cancel or reschedule, please contact the small business directly.</p>
<p>Thank you for booking with Harbour Salon.</p>
```

When a manage link exists, the plain text and HTML include that link instead of the contact line. Turning the control off sends nothing.

## #42 Sign-up confirmation

Subject: `Confirm your StyleFlo email address`

Plain text:

```
Hello,

Please confirm your email address for your StyleFlo account.

Confirm email address: {{ .ConfirmationURL }}

If you did not create a StyleFlo account, you can ignore this email.

Reply to this email and it will reach StyleFlo support.
```

HTML: `supabase/templates/confirmation.html`

## #43 Magic sign-in link

Subject: `Your StyleFlo sign-in link`

Plain text:

```
Hello,

Use the link below to sign in to StyleFlo.

Sign in to StyleFlo: {{ .ConfirmationURL }}

If you did not ask for a sign-in link, you can ignore this email.

Reply to this email and it will reach StyleFlo support.
```

HTML: `supabase/templates/magic_link.html`

## #44 Password reset

Subject: `Reset your StyleFlo password`

Plain text:

```
Hello,

Use the link below to choose a new password.

Reset password: {{ .ConfirmationURL }}

If you did not ask to reset your password, you can ignore this email.

Reply to this email and it will reach StyleFlo support.
```

HTML: `supabase/templates/recovery.html`

Admin notices `#32`–`#35`, `#37`, `#38`, `#46`–`#48` and `#54` are in the following part of this batch. They stay off until `SYSTEM_EMAILS_BATCH4_ENABLED=true`.
