// Invite landing page (/join/CODE and /record/invite/CODE, served by _worker.js).
// Posts the email plus the invite code to /api/early-access. Without JavaScript
// the form posts normally and the worker redirects back here.
(() => {
  const form = document.getElementById('ea-form');
  const done = document.getElementById('ea-done');
  const status = document.getElementById('ea-status');
  if (!form || !done || !status) return;
  const email = form.elements.email, submit = form.querySelector('[type="submit"]');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const ERRORS = {
    email: 'Enter a valid email, like name@example.com.',
    error: 'Something went wrong. Try again, or email support@ballboi.tennis.',
  };
  function showError(kind, field) {
    status.textContent = ERRORS[kind];
    status.classList.add('err');
    email.removeAttribute('aria-invalid');
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  }
  function showDone() { form.hidden = true; done.hidden = false; done.focus(); }

  const result = new URLSearchParams(location.search).get('early-access');
  if (result === 'joined') showDone();
  else if (result === 'invalid') showError('email');
  else if (result === 'error') showError('error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = email.value.trim();
    if (!EMAIL_RE.test(value)) return showError('email', email);
    submit.disabled = true; submit.textContent = 'Joining…';
    status.classList.remove('err'); status.textContent = '';
    try {
      const res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: value, ref: form.elements.ref.value, website: form.elements.website.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) return showDone();
      if (body.error === 'email') return showError('email', email);
      showError('error');
    } catch {
      showError('error');
    } finally {
      submit.disabled = false; submit.textContent = 'Join';
    }
  });
})();
