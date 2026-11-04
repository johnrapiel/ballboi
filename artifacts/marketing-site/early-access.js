// "Get early access": the pill opens an email form that posts to /api/early-access.
// Without JavaScript the form shows by default and posts normally (see _worker.js).
(() => {
  const pill = document.getElementById('soon');
  const form = document.getElementById('ea-form');
  const done = document.getElementById('ea-done');
  const status = document.getElementById('ea-status');
  if (!pill || !form || !done || !status) return;
  const email = form.elements.email, zip = form.elements.zip, submit = form.querySelector('[type="submit"]');

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const ERRORS = {
    email: 'Enter a valid email, like name@example.com.',
    zip: 'Zip should be 5 digits, or leave it blank.',
    error: 'Something went wrong. Try again, or email support@ballboi.tennis.',
  };

  function open(focus = true) {
    pill.hidden = true;
    pill.setAttribute('aria-expanded', 'true');
    form.hidden = false;
    if (focus) email.focus();
  }
  function showError(kind, field) {
    status.textContent = ERRORS[kind];
    status.classList.add('err');
    email.removeAttribute('aria-invalid'); zip.removeAttribute('aria-invalid');
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  }
  function showDone() {
    pill.hidden = true; form.hidden = true; done.hidden = false;
    done.focus();
  }

  pill.addEventListener('click', () => open());

  // Back from a no-JavaScript post: /?early-access=joined|invalid|error
  const result = new URLSearchParams(location.search).get('early-access');
  if (result === 'joined') showDone();
  else if (result === 'invalid') { open(false); showError('email'); }
  else if (result === 'error') { open(false); showError('error'); }

  zip.addEventListener('input', () => { zip.value = zip.value.replace(/\D/g, '').slice(0, 5); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const e1 = email.value.trim(), z = zip.value.trim();
    if (!EMAIL_RE.test(e1)) return showError('email', email);
    if (z && !/^\d{5}$/.test(z)) return showError('zip', zip);

    submit.disabled = true; submit.textContent = 'Joining…';
    status.classList.remove('err'); status.textContent = '';
    try {
      const res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: e1, zip: z, website: form.elements.website.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) return showDone();
      if (body.error === 'email') return showError('email', email);
      if (body.error === 'zip') return showError('zip', zip);
      showError('error');
    } catch {
      showError('error');
    } finally {
      submit.disabled = false; submit.textContent = 'Join';
    }
  });
})();
