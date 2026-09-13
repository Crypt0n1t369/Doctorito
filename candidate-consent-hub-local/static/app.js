const state = { candidates: [], campaigns: [], config: null, currentView: 'overview' };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const labels = {
  review_required: 'Review required', eligible: 'Eligible', do_not_contact: 'Do not contact',
  not_requested: 'Not requested', pending: 'Pending', granted: 'Granted', declined: 'Declined',
  withdrawn: 'Withdrawn', new: 'New', legal_review: 'Legal review', invited: 'Invited',
  interested_unverified: 'Interested — unverified', consented: 'Consented', replied: 'Replied',
  bounced: 'Bounced', deletion_requested: 'Deletion requested', draft: 'Draft', active: 'Active',
  paused: 'Paused', informing: 'Informing', verification: 'Verification'
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function badge(value) {
  const safe = String(value || 'not_requested').replace(/[^a-z_]/g, '');
  return `<span class="badge ${safe}">${escapeHtml(labels[value] || value || '—')}</span>`;
}

function initials(candidate) {
  return `${candidate.first_name?.[0] || ''}${candidate.last_name?.[0] || ''}`.toUpperCase() || '—';
}

function person(candidate) {
  const name = `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim() || 'Unnamed candidate';
  return `<div class="person"><span class="avatar">${escapeHtml(initials(candidate))}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(candidate.email)}</small></div></div>`;
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.style.background = isError ? '#8b3f34' : '';
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function switchView(view) {
  state.currentView = view;
  $$('.view').forEach((element) => element.classList.toggle('active', element.id === `${view}-view`));
  $$('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === view));
  const titles = { overview: 'Candidate control centre', candidates: 'Candidate register', campaigns: 'Campaign architecture', audit: 'Consent audit trail', settings: 'Configuration' };
  $('#page-title').textContent = titles[view] || 'Candidate Consent Hub';
  if (view === 'audit') loadAudit();
}

function renderOverview(summary) {
  $('#metric-eligible').textContent = summary.totals.eligible || 0;
  $('#metric-review').textContent = summary.totals.review_queue || 0;
  $('#metric-consented').textContent = summary.totals.consented || 0;
  $('#metric-suppressed').textContent = summary.totals.suppressed || 0;
  const visible = state.candidates.slice(0, 6);
  $('#overview-candidates').innerHTML = visible.length ? visible.map((candidate) => `<tr><td>${person(candidate)}</td><td>${badge(candidate.eligibility)}</td><td>${badge(candidate.consent_beta_status)}</td><td>${badge(candidate.consent_cv_status)}</td><td>${badge(candidate.status)}</td><td>${escapeHtml(candidate.retention_until || 'Not set')}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">No candidate records yet.</td></tr>';
  const queue = state.candidates.filter((candidate) => ['interested_unverified', 'legal_review'].includes(candidate.status));
  $('#queue-count').textContent = queue.length;
  $('#review-queue').innerHTML = queue.length ? queue.slice(0, 5).map((candidate) => `<div class="review-item"><strong>${escapeHtml(`${candidate.first_name} ${candidate.last_name}`.trim())}</strong><small>${candidate.status === 'legal_review' ? 'Original lawful-contact basis needs review.' : 'Interest received; explicit choices not yet recorded.'}</small><button data-review-id="${candidate.id}">Open in register →</button></div>`).join('') : '<p class="empty">The review queue is clear.</p>';
  const hasDemo = state.candidates.some((candidate) => candidate.is_demo);
  $('#sample-banner').hidden = !hasDemo;
}

function renderCandidates() {
  const q = $('#search')?.value.toLowerCase() || '';
  const status = $('#status-filter')?.value || '';
  const rows = state.candidates.filter((candidate) => {
    const haystack = `${candidate.first_name} ${candidate.last_name} ${candidate.email} ${candidate.candidate_key}`.toLowerCase();
    return (!q || haystack.includes(q)) && (!status || candidate.status === status);
  });
  $('#candidate-table').innerHTML = rows.length ? rows.map((candidate) => `<tr><td>${person(candidate)}<small>${escapeHtml(candidate.candidate_key)}</small></td><td>${escapeHtml(candidate.source_context || '—')}</td><td>${badge(candidate.eligibility)}</td><td>${badge(candidate.consent_beta_status)}</td><td>${badge(candidate.consent_cv_status)}</td><td>${badge(candidate.consent_contact_status)}</td><td>${badge(candidate.status)}</td><td><div class="row-actions"><button data-manage-id="${candidate.id}">Manage</button><a class="link-button" href="/consent/${encodeURIComponent(candidate.consent_token)}" target="_blank" rel="noreferrer">Consent ↗</a></div></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No candidates match these filters.</td></tr>';
}

function renderCampaigns() {
  $('#campaign-grid').innerHTML = state.campaigns.length ? state.campaigns.map((campaign) => `<article class="panel campaign-card"><header><div><p class="eyebrow">${escapeHtml(labels[campaign.phase] || campaign.phase)} phase</p><h3>${escapeHtml(campaign.name)}</h3></div>${badge(campaign.status)}</header><p>${escapeHtml(campaign.description || 'No campaign description yet.')}</p><div class="campaign-meta"><div><small>Smartlead ID</small><strong>${escapeHtml(campaign.smartlead_campaign_id || 'Not connected')}</strong></div><div><small>Last sync</small><strong>${escapeHtml(campaign.last_synced_at || 'Manual mode')}</strong></div></div></article>`).join('') : '<p class="empty">No campaign definitions yet.</p>';
}

function refreshCampaignOptions() {
  const select = $('#edit-campaign-select');
  const current = select.value;
  select.innerHTML = '<option value="">No campaign</option>' + state.campaigns.map((campaign) => `<option value="${escapeHtml(campaign.name)}">${escapeHtml(campaign.name)}</option>`).join('');
  select.value = current;
}

function openCandidateManager(id) {
  const candidate = state.candidates.find((item) => item.id === Number(id));
  if (!candidate) return;
  const form = $('#edit-form');
  refreshCampaignOptions();
  ['id', 'status', 'eligibility', 'retention_until', 'privacy_notice_version', 'campaign_name', 'cv_reference'].forEach((name) => {
    if (form.elements[name]) form.elements[name].value = candidate[name] || '';
  });
  $('#edit-candidate-name').textContent = `${candidate.first_name} ${candidate.last_name}`.trim() || 'Manage candidate';
  $('#edit-candidate-key').textContent = candidate.candidate_key;
  $('#edit-consent-summary').textContent = `Beta: ${labels[candidate.consent_beta_status] || candidate.consent_beta_status}; CV: ${labels[candidate.consent_cv_status] || candidate.consent_cv_status}; contact: ${labels[candidate.consent_contact_status] || candidate.consent_contact_status}`;
  $('#edit-consent-link').href = `/consent/${encodeURIComponent(candidate.consent_token)}`;
  $('#edit-error').textContent = '';
  $('#edit-dialog').showModal();
}

async function loadAudit() {
  try {
    const { events } = await api('/api/consent-events');
    $('#audit-log').innerHTML = events.length ? events.map((event) => `<div class="audit-row"><div><strong>${escapeHtml(`${event.first_name} ${event.last_name}`.trim())}</strong><small>${escapeHtml(event.email)}</small></div><div><strong>${escapeHtml(labels[event.scope] || event.scope.replaceAll('_', ' '))}</strong><small>${escapeHtml(event.source)} · notice ${escapeHtml(event.notice_version)}</small></div><div>${badge(event.decision)}</div><small>${escapeHtml(event.recorded_at)}</small></div>`).join('') : '<p class="empty">Consent events will appear here after candidates make a choice.</p>';
  } catch (error) { showToast(error.message, true); }
}

async function loadAll() {
  try {
    const [summary, candidateData, campaignData, config] = await Promise.all([api('/api/summary'), api('/api/candidates'), api('/api/campaigns'), api('/api/config')]);
    state.candidates = candidateData.candidates;
    state.campaigns = campaignData.campaigns;
    state.config = config;
    renderOverview(summary);
    renderCandidates();
    renderCampaigns();
    refreshCampaignOptions();
    $('#connection-pill').textContent = config.mode === 'automatic' ? 'Automatic sync ready' : 'Manual mode';
    $('#setting-mode').textContent = config.mode === 'automatic' ? 'Pro/API ready' : 'Base/manual';
    $('#setting-public-url').textContent = config.public_url;
    $('#setting-webhook').textContent = `${config.public_url}${config.webhook_path}`;
    $('#setting-secret').textContent = config.webhook_secret_configured ? 'Configured' : 'Not configured';
  } catch (error) { showToast(error.message, true); }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field); if (row.some((value) => value.trim())) rows.push(row);
  const headers = (rows.shift() || []).map((value) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replaceAll(' ', '_'));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

$$('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$$('[data-view-link]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewLink)));
$('#open-add').addEventListener('click', () => $('#add-dialog').showModal());
$('#close-add').addEventListener('click', () => $('#add-dialog').close());
$('#cancel-add').addEventListener('click', () => $('#add-dialog').close());
$('#search').addEventListener('input', renderCandidates);
$('#status-filter').addEventListener('change', renderCandidates);
$('#review-queue').addEventListener('click', (event) => { if (event.target.closest('[data-review-id]')) switchView('candidates'); });
$('#candidate-table').addEventListener('click', (event) => {
  const button = event.target.closest('[data-manage-id]');
  if (button) openCandidateManager(button.dataset.manageId);
});
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.closeDialog}`).close()));
$('#open-campaign').addEventListener('click', () => $('#campaign-dialog').showModal());

$('#add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await api('/api/candidates', { method: 'POST', body: JSON.stringify(payload) });
    event.currentTarget.reset(); $('#add-dialog').close(); showToast('Candidate record saved.'); await loadAll();
  } catch (error) { $('#form-error').textContent = error.message; }
});

$('#edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  const id = values.id;
  delete values.id;
  try {
    await api(`/api/candidates/${id}`, { method: 'PATCH', body: JSON.stringify(values) });
    $('#edit-dialog').close(); showToast('Candidate record updated.'); await loadAll();
  } catch (error) { $('#edit-error').textContent = error.message; }
});

$('#campaign-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await api('/api/campaigns', { method: 'POST', body: JSON.stringify(payload) });
    event.currentTarget.reset(); $('#campaign-dialog').close(); showToast('Campaign definition saved.'); await loadAll();
  } catch (error) { $('#campaign-error').textContent = error.message; }
});

$('#csv-input').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const candidates = parseCsv(await file.text());
    const result = await api('/api/import', { method: 'POST', body: JSON.stringify({ candidates }) });
    showToast(`Import complete: ${result.created} created, ${result.updated} updated, ${result.failed} failed.`);
    await loadAll();
  } catch (error) { showToast(error.message, true); }
  event.target.value = '';
});

$('#clear-demo').addEventListener('click', async () => {
  try { const result = await api('/api/demo/clear', { method: 'POST', body: '{}' }); showToast(`${result.deleted} sample records removed.`); await loadAll(); }
  catch (error) { showToast(error.message, true); }
});

loadAll();
