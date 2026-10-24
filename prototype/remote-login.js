document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('login-submit');
  const status = document.getElementById('login-status');
  button.disabled = true; status.textContent = '正在登录…';
  try {
    const response = await fetch('/remote-api/login', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Zhixu-Client': '1' },
      body: JSON.stringify({ password: document.getElementById('login-password').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '登录失败，请重试');
    location.replace('/');
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
