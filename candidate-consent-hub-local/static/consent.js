const form = document.querySelector('#consent-form');
const error = document.querySelector('#error');
const success = document.querySelector('#success');

async function submitChoice(action) {
  error.textContent = '';
  const data = new FormData(form);
  const payload = {
    token: data.get('token'),
    action,
    cv_match: data.has('cv_match'),
    direct_email: data.has('direct_email'),
    direct_phone: data.has('direct_phone'),
  };
  if (action === 'grant' && !payload.cv_match) {
    error.textContent = 'Select CV matching to join the opportunity-matching shortlist, or choose Decline.';
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
