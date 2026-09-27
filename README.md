# Lead Compass

Build a functional V1 of a web application called **Lead Generation OS**.

The primary objective of this V1 is FUNCTIONALITY, reliability, and real integrations — NOT visual polish.

Do not spend excessive effort creating a beautiful dashboard, animations, complex charts, landing pages, or marketing pages. Use a clean, simple, professional admin-style interface that makes the workflows easy to test.

This is an internal lead-generation and outreach tool for an agency.

## CORE WORKFLOW

The complete working workflow must be:

1. Find/import business leads
2. Store leads in Supabase
3. Analyze/qualify leads using an AI provider
4. Select leads for outreach
5. Write an email
6. Optionally personalize the email using AI
7. Connect a Gmail account using Google OAuth
8. Preview emails
9. Send emails through the connected Gmail account
10. Store the outreach status/history

Everything should use real data and real backend operations. Do NOT create fake/demo functionality.

---

# TECH STACK

Use:

* Lovable for the application
* Supabase for database, authentication, and backend
* Supabase Edge Functions for server-side API calls and sensitive operations
* OpenRouter and/or Gemini for AI
* Gmail API for email sending
* Google OAuth for Gmail connection

API keys and OAuth secrets must NEVER be exposed in frontend code.

All sensitive API calls should go through Supabase Edge Functions or another secure server-side mechanism.

---

# 1. AUTHENTICATION

Implement basic authentication using Supabase Auth.

Users should be able to:

* Sign up
* Log in
* Log out

Every user's leads and settings must be isolated from other users.

Do not build complicated team/workspace functionality in V1.

---

# 2. LEAD SOURCE / MAP SCRAPER MODULE

Create a functional "Map Scraper" module.

IMPORTANT:

Do NOT create a fake scraper that simply generates example businesses.

Do NOT hardcode fake leads.

Design this as a real lead-source integration layer.

The user should be able to enter:

* Search keyword
* Location
* Number of results

Example:

Keyword:
Restaurants

Location:
Dubai, UAE

Results:
50

Then the application should retrieve business information from the configured lead-data/map source.

The source should be implemented behind a backend/server-side function so the provider can be changed later without rebuilding the application.

Create a clean abstraction such as:

leadSource.searchBusinesses(query, location, limit)

The returned lead data should support, where available:

* Business name
* Category
* Address
* City
* Country
* Website
* Phone
* Google Maps URL
* Rating
* Review count
* Business description
* Other available public business information

If the external source/API is not configured yet, show a clear configuration state instead of pretending that scraping succeeded.

Do NOT bypass CAPTCHAs, authentication, anti-bot protections, or other access controls.

---

# 3. LEAD DATABASE

Create a Supabase `leads` table.

Suggested fields:

* id
* user_id
* company_name
* first_name
* last_name
* industry
* address
* city
* country
* website
* email
* phone
* maps_url
* rating
* review_count
* description
* source
* source_id
* ai_score
* ai_analysis
* recommended_service
* qualification_status
* outreach_status
* created_at
* updated_at

Create appropriate indexes.

Prevent obvious duplicate leads.

For example, if the same business is imported twice, do not create two identical records when a reliable source ID, website, or other unique identifier can identify the existing business.

---

# 4. LEAD LIST

Create a simple functional lead table.

It does NOT need to be visually impressive.

Each row should show:

* Checkbox
* Business name
* Industry
* Location
* Website
* Email
* AI score
* Qualification status
* Outreach status

Allow:

* Search
* Filtering
* Sorting
* Selecting multiple leads
* Opening a lead's details
* Deleting a lead

The user must be able to select multiple leads for outreach.

---

# 5. LEAD DETAILS

When opening a lead, show all stored information.

Also show:

AI Analysis

AI Score

Recommended Service

Qualification Status

Outreach Status

Outreach History

Provide a button:

"Analyze Lead"

This should call the configured AI provider and save the result to Supabase.

---

# 6. AI INTEGRATION

Implement an AI provider abstraction.

Support:

Provider 1:
OpenRouter

Provider 2:
Gemini

The user should be able to configure which provider is being used.

Do not hardcode API keys into the application.

Store API configuration securely.

The AI should receive the actual lead information and return structured JSON.

For example:

{
"score": 87,
"qualification": "high",
"recommended_service": "Website Development",
"reason": "The business has an active online presence but lacks a strong website.",
"website_quality": "poor",
"social_presence": "strong"
}

Use structured responses rather than parsing random natural-language output whenever possible.

Handle invalid AI responses gracefully.

---

# 7. AI LEAD QUALIFICATION

The AI should analyze a lead based on the information actually available.

Do NOT invent missing information.

If there is no website, say there is no website.

If an email is missing, leave it empty.

If information cannot be verified, mark it as unknown.

The AI should identify potential agency opportunities such as:

* Website development
* Website redesign
* SEO
* Social media marketing
* Paid advertising
* Ecommerce
* Content marketing

The system should save:

* Score
* Qualification
* Reason
* Recommended service

Do not make the score the only useful output. The explanation is important.

---

# 8. BULK AI ANALYSIS

Allow the user to select multiple leads and click:

"Analyze Selected"

The backend should process them individually.

Do not send hundreds of requests simultaneously.

Implement reasonable batching/concurrency control.

Show progress:

Analyzing 12 / 50

If one lead fails, continue processing the others and report the failed records.

---

# 9. OUTREACH COMPOSER

Create a simple outreach screen.

The user should be able to select multiple leads and write one email.

Fields:

Subject

Message

Support dynamic variables:

{{first_name}}
{{company_name}}
{{industry}}
{{city}}
{{country}}
{{website}}

Example:

Subject:

A quick idea for {{company_name}}

Message:

Hi {{first_name}},

I came across {{company_name}} and wanted to reach out...

The application should replace variables separately for each recipient.

If a variable is unavailable, handle it safely instead of sending "undefined" or broken text.

---

# 10. AI PERSONALIZATION

Provide an optional:

"AI Personalize"

feature.

The user writes a base email.

The AI receives:

* Base email
* Lead information
* AI analysis
* Recommended service

Then generates a personalized version for each selected lead.

IMPORTANT:

The AI must not invent facts about the business.

It should only personalize using information available in the lead record.

Allow the user to preview each generated email before sending.

---

# 11. GMAIL CONNECTION

Implement Gmail connection using Google OAuth.

Create a:

"Connect Gmail"

button.

After authorization, securely store the required OAuth credentials/tokens server-side.

Do not expose access or refresh tokens to the browser.

Show:

Connected Gmail:
[example@gmail.com](mailto:example@gmail.com)

Provide:

Disconnect Gmail

The user should be able to reconnect if authorization expires or is revoked.

---

# 12. EMAIL SENDING

Use the Gmail API to send emails from the connected Gmail account.

The user workflow must be:

Select leads
→ Compose email
→ Generate personalization if desired
→ Preview
→ Confirm
→ Send

Do NOT automatically send emails immediately when the user selects leads.

Require explicit confirmation.

Before sending, show:

Recipients:
20

Subject:
...

Preview:

...

Button:

"Send to 20 Leads"

---

# 13. EMAIL SENDING SAFETY

Implement controlled sending rather than firing all requests simultaneously.

Process emails in a queue/batch.

If Gmail rejects one email:

* Record the error
* Mark that lead as failed
* Continue processing other valid recipients where appropriate

Do not retry indefinitely.

Prevent accidental duplicate sends.

Before sending, check whether the same campaign/email has already been sent to that lead.

---

# 14. OUTREACH HISTORY

Create an `outreach_messages` table.

Store:

* id
* user_id
* lead_id
* subject
* body
* personalized_body
* recipient_email
* status
* sent_at
* error_message
* gmail_message_id
* campaign_id
* created_at

Possible statuses:

* Draft
* Queued
* Sent
* Failed

The lead should also have an overall outreach status.

---

# 15. CAMPAIGNS

Create a very simple campaign system.

A campaign should contain:

* id
* user_id
* name
* subject
* body
* created_at

When sending to selected leads, allow the user to associate the outreach with a campaign.

Do NOT build complex campaign automation in V1.

No drip sequences yet.

No automatic follow-ups yet.

---

# 16. BASIC OUTREACH TRACKING

For V1, track:

* Selected
* Draft
* Sent
* Failed

If practical with the Gmail integration, store the Gmail message ID.

Do NOT spend time building advanced email open tracking in V1.

---

# 17. SETTINGS

Create a simple Settings page.

Sections:

AI Provider

* OpenRouter
* Gemini

API configuration

Gmail

* Connected account
* Disconnect

Lead Source

* Current provider
* API configuration/status

The UI can be basic.

---

# 18. ERROR HANDLING

This is extremely important.

Every external integration should have proper error handling.

Examples:

AI API unavailable
→ show clear error

Gmail authorization expired
→ ask user to reconnect

Gmail send failed
→ record failure and show reason

Lead source unavailable
→ show provider error

Invalid API key
→ show configuration error

Missing email
→ prevent sending to that lead

Do not silently fail.

Do not show fake success messages.

---

# 19. DATABASE SECURITY

Use Supabase Row Level Security.

Users must only be able to access:

* Their own leads
* Their own campaigns
* Their own outreach records
* Their own settings

Do not expose another user's data.

Sensitive credentials must not be stored in publicly accessible database fields.

---

# 20. IMPORTANT V1 PRIORITIES

Priority order:

1. Real lead import
2. Real Supabase storage
3. Real AI analysis
4. Real lead selection
5. Real Gmail OAuth
6. Real email sending
7. Outreach history
8. Basic UI

Do NOT prioritize:

* Beautiful animations
* Landing pages
* Fancy charts
* Marketing copy
* Complex CRM
* Advanced analytics
* LinkedIn automation
* WhatsApp
* Automated follow-up sequences

---

# 21. NO MOCK FUNCTIONALITY

This is critical.

Do not create:

* Fake API responses
* Fake leads
* Fake Gmail sending
* Fake AI responses
* Fake "connected" states
* Hardcoded dashboards
* Simulated success messages

If an integration cannot work because credentials/provider configuration are missing, clearly show:

"Not configured"

and provide the required configuration path.

Every button should either perform a real operation or clearly indicate that the required integration is not configured.

---

# 22. DEVELOPMENT APPROACH

Build this in small functional stages.

First establish:

Supabase database
→ authentication
→ lead table
→ lead import abstraction
→ AI integration
→ Gmail OAuth
→ email sending

Then connect the frontend to these real backend functions.

Test each workflow before moving to the next.

The final V1 must allow me to perform this complete test:

1. Log in
2. Search/import real businesses
3. See them in Leads
4. Select several leads
5. Analyze them with AI
6. Write an email
7. Personalize it if desired
8. Connect Gmail
9. Preview the emails
10. Send them
11. See the resulting send status/history

Keep the UI simple and functional. Focus the majority of development effort on making these workflows actually work end-to-end.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://hmbleados.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/51edea99-4a60-43bc-9ec8-444097523a37).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
