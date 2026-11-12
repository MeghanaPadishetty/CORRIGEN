(() => {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const passwordToggle = document.getElementById('password-toggle');
  const submitButton = document.getElementById('sign-in-button');
  const demoButton = document.getElementById('demo-button');
  const message = document.getElementById('form-message');
  let submitting = false;

  function showMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle('success', success);
    message.classList.toggle('visible', Boolean(text));
  }

  function setLoading(active, demo = false) {
    submitting = active;
    submitButton.disabled = active;
    demoButton.disabled = active;
    submitButton.classList.toggle('is-loading', active && !demo);
    demoButton.classList.toggle('is-loading', active && demo);
    submitButton.querySelector('.button-label').textContent = active && !demo ? 'Signing in...' : 'Sign In to CORRIGEN';
    submitButton.setAttribute('aria-busy', String(active && !demo));
    demoButton.setAttribute('aria-busy', String(active && demo));
  }

  async function authenticate(endpoint, credentials = null, demo = false) {
    if (submitting) return;
    if (!demo) {
      if (!emailInput.value.trim()) { showMessage('Please enter your email address.'); emailInput.focus(); return; }
      if (!passwordInput.value) { showMessage('Please enter your password.'); passwordInput.focus(); return; }
      if (!emailInput.validity.valid) { showMessage('Please enter a valid email address.'); emailInput.focus(); return; }
    }

    setLoading(true, demo);
    showMessage('');
    try {
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: credentials ? JSON.stringify(credentials) : '{}'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Unable to sign in. Please try again.');
      showMessage('Signed in. Opening CORRIGEN…', true);
      window.location.replace('/');
    } catch (error) {
      showMessage(error.message === 'Failed to fetch' ? 'Unable to sign in. Please try again.' : error.message);
      setLoading(false, demo);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    authenticate('login', { email: emailInput.value.trim(), password: passwordInput.value });
  });
  demoButton.addEventListener('click', () => authenticate('demo', null, true));
  passwordToggle.addEventListener('click', () => {
    const showing = passwordInput.type === 'password';
    passwordInput.type = showing ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', String(showing));
    passwordToggle.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
    passwordInput.focus();
  });
  document.getElementById('forgot-password').addEventListener('click', (event) => {
    event.preventDefault();
    showMessage('Password recovery is unavailable in this demonstration. Please use the configured demo credentials.');
  });
})();
