# Candidate Consent Hub

A private, dependency-free candidate register and consent audit trail designed to work beside Smartlead. Smartlead sends the outreach; this hub remains the source of truth for eligibility, consent, retention, suppression, and evidence.

## What it includes

- Candidate register with lawful-contact eligibility gate
- Separate CV-matching, email-contact, and telephone-contact permissions
- Secure, unguessable consent links with no preselected checkboxes
- Append-only consent event log
- Human review queue for unclear records and interested-but-unverified candidates
- Campaign definitions for informing and verification phases
- Smartlead-minimal CSV export containing only eligible candidates
- Full administrative CSV export and CSV import/upsert by email
- Signed, idempotent Smartlead webhook receiver
- Local SQLite database with foreign keys, WAL mode, and indexed workflow fields

## Run locally

Use Python 3.11 or newer:

```bash
python3 server.py
```

Then open <http://127.0.0.1:8787/>.

The server binds to `127.0.0.1` by default, so other computers cannot access it. The database is created at `data/candidate_hub.db`.

## CSV import

The import accepts the following headers. Only `email` is mandatory:

```text
first_name,last_name,email,phone,location,source_context,cv_reference,received_at,original_basis,eligibility,status,retention_until,privacy_notice_version,campaign_name
```

Download `sample-import.csv` as a starting point. Re-importing the same email updates the existing record rather than creating a duplicate.

## Smartlead Base workflow

1. Review candidate eligibility in the hub.
2. Open **Candidates → Export eligible for Smartlead**.
3. Upload that minimal CSV into the Smartlead informing campaign.
4. Use `{{consent_form_link}}` in the email copy.
5. Smartlead stops on reply and routes interested replies to its verification subsequence.
6. The candidate uses the consent link; the hub records the choices and evidence.
7. Export or review the hub before using a CV for matching.

This mode does not require HubSpot or another CRM. It requires occasional CSV movement because Smartlead Base does not provide the Pro API connection.

## Smartlead Pro webhook mode

For automatic inbound event synchronization, deploy the hub to an HTTPS URL and configure:

```bash
export CANDIDATE_HUB_PUBLIC_URL="https://candidate.example.com"
export SMARTLEAD_WEBHOOK_SECRET="replace-with-a-long-random-secret"
export PRIVACY_NOTICE_URL="https://example.com/candidate-privacy"
```

Point the Smartlead webhook to:

```text
https://candidate.example.com/api/webhooks/smartlead
```

Enable at least these events: reply, link click, unsubscribe, bounce, and lead-category update. The handler verifies `X-Smartlead-Signature` with HMAC SHA-256 when the secret is configured and deduplicates events using `X-Request-Id`.

The current build receives Smartlead events. Outbound API actions—such as automatically globally unsubscribing someone in Smartlead—should be added only after a Pro API key is available and the exact suppression policy has been approved.

## Security and deployment boundary

This version is intentionally local. Do not expose it directly to the internet by changing the bind host without adding proper admin authentication, TLS, backups, rate limiting, and a configured webhook secret. A deployed version should separate the public consent route from the private administration routes.

Do not store CV contents in Smartlead. In this hub, use `cv_reference` for a restricted internal file or ATS reference. Review the privacy wording, retention policy, subprocessors, and lawful basis with your DPO or lawyer before inviting real candidates.

## Tests

```bash
python3 -m unittest discover -s tests -v
```
