---
created: 2026-09-15
tags:
status: active
last_active:
---

Twilio is our preferred telecommunications partner, supplying all mobile and landlines numbers in the UK and Europe

We have integrated the ability to purchase a number in the dashboard, however, there are a number of other things needed before launch

1. If the b2b user enters the number purchase journey, they must not be able to secure a number against their account unless the opion is enabled in their account, instead, they must be presented with an upgrade your account modal allowing the to continue to stripe to complete the upgrade, once payment has been made the b2b user must be returned to the dashboard to continue the purchase.
2. The user must be given the opportunity to choose between a landline or mobile telephone number.
3. The user must be given the opportunity to select the first xx numbers of their selected product.
4. the user must be shown any 'other' popular products normally purchased at the same time (voice minutes, whatsapp etc) as a form of cross sell

## To be taken into consideration
We should be mindful that Styleflo has ambition to expand into other European markets, including Portugal, we should build anything with this in mind.

The b2b user never needs to be aware that our partner is Twilio and this must not be displayed anywhere in the dashboard

## For landlines numbers

Allow users to select the area code for a landlines, in the form of a pre purchase request where the b2b user enters the code such as 0151 for liverpool.  Note Twilio ignores the lead 0 as it uses the international code +44 for our purpose we should accept 0151 and ignore the 0 or 151 if entered in this format.

The user must be shown a list of available numbers, unless they have entered a number that is not available, I which case they must be shown a message informing them that the number entered is invalid 

The number field must not be restrictive as some local codes are more than 3 numbers, Warrington as an example is 1925

Once the number has been selected the agent must become available straight away to answer any call made to that number.

In the following circumstances the number must be cancelled and returned to Twilio:
- If the user cancels their subscription to a landline or mobile number, the b2b admin must be able to cancel the number from within the dashboard.
- the account lapses due to non payment of the monthly fee, subject to any grace period that may be offered by Styleflo while we attempt to re activate the account.

## For mobile numbers
The same rules as above apply, though the main reason for offering mobile numbers will be to offer users WhatsApp marketing

