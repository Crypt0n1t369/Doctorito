const form = document.querySelector('#consent-form');
const error = document.querySelector('#error');
const success = document.querySelector('#success');

async function submitChoice(action) {
  error.textContent = '';
  const data = new FormData(form);
  const payload = {
    token: data.get('token'),
    action,
    beta_shortlist: data.has('beta_shortlist'),
    cv_match: data.has('cv_match'),
    direct_email: data.has('direct_email'),
    direct_phone: data.has('direct_phone'),
  };
  if (action === 'grant' && !payload.beta_shortlist && !payload.cv_match && !payload.direct_email && !payload.direct_phone) {
    error.textContent = 'Select at least one option, or choose Decline.';
    return;
  }
  try {
    const response = await fetch('/api/consent', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to save your choices.');
    form.hidden = true;
    success.hidden = false;
  } catch (exception) { error.textContent = exception.message; }
}

form.addEventListener('submit', (event) => { event.preventDefault(); submitChoice('grant'); });
document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => submitChoice(button.dataset.action)));
