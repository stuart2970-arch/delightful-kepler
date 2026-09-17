---
created: 2026-09-10
tags:
  - styleflo
  - glossary
  - chat
  - voice
  - staff
  - google-calendar
status: Backlog
last_active:
---
# Glossary of StyleFlo Elements


This note contains all components/ features currently supplied in StyleFlo along with the dependencies on other components/ features and whether it is metered or not.

- Dependency = One can not work without the other
- Metered = Includes a significant cost element within the pricing tier.
- Agent = AI agent in a chat feature
- b2b user - Agent admin
- End User = b2b's customer
- Chat = The agent + the text input interface that is contained within the script supplied once the b2b customer has completed the build process and allows the end user to communicate with the agent.  This is the minimum payload for a product
	- dependency = needs to be displayed on a webpage
	- can be displayed in multiple formats;
		- as a floating 'chat' icon
		- as an embedded widget
	- uses knowledgebase
	- uses agent rules
- Monthly chat Messages (message_allowance) = when a user engages with the agent on any website the code is embedded in.
	- dependency = has agent & chat
	- uses knowledgebase
	- uses gemini
- Knowledgebase Data Chunks (knowledge_data_chunks) = data ingested by the agent, supplied by the agent admin
	- dependency = user has an agent plus one of chat, whatsapp, instagram, phone number (either landline or mobile)
	- Users cloud
- Agent rules & directives = specific business instructions, guidelines, and constraints for this agent. The agent will strictly adhere to these rules in all responses.
	- dependency - user has an agent plus one of chat, whatsapp, instagram, phone number (either landline or mobile)
- Google Calendar Bookings (google_calendar) = the ability to book meetings/ appointments in a google calendar
	- dependency = user has authenticated using Oauth and a Google account
- Staff Bio & Rota (staff_names) = name, image, specialist subjects and rota details of each employee
	- dependency = webpage
- Services Limit (services_limit) = total number of services/ products offered to the customer by the business
	- dependency = webpage
- Voice Agent Limits (voice_agent_minutes_web) = chat conversations with the agent via the website chat
	- dependency = user has an agent plus one of chat, whatsapp, phone number (either landline or mobile)
- ~~Phone Voice Agent Minutes (vapi_voice_minutes) = chat conversations with the agent via the phone (either landline or mobile)~~
	- no longer needed, the price diff between internet and telephone is 01p per minute
For later development
- SMS Reminders (sms) = if the tier has mobile, these will be the sms reminders sent to users with booked appointments
- SMS Marketing (sms_marketing) = the number of marketing texts that can be sent by the business to its customers
- SMS Messaging (messaging_sms) = the number of texts the agent can send to customers with inks to services/ products embedded

https://stuart2970.atlassian.net/browse/STYL-121

