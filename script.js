const welcome = document.querySelector('.welcome');
const layout = document.querySelector('.layout');
const enterHint = document.querySelector('.enter-hint');

let canEnter = false;

setTimeout(() => {
  if (enterHint) {
    enterHint.hidden = false;
    requestAnimationFrame(() => enterHint.classList.add('show'));
  }
  canEnter = true;
}, 3000);

window.addEventListener('keydown', (e) => {
  if (!welcome || welcome.classList.contains('hidden')) return;
  if (e.key === 'Enter' && canEnter) {

    welcome.classList.add('hidden');
    welcome.setAttribute('aria-hidden', 'true');
    if (layout) layout.setAttribute('aria-hidden', 'false');

    const firstLink = document.querySelector('#toc a');
    firstLink?.focus();
  }
});

const toc = document.getElementById('toc');
const links = Array.from(toc.querySelectorAll('a'));

links.forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const id = a.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
  });
});

const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      const id = entry.target.id;
      const link = links.find(l => l.getAttribute('href') === `#${id}`);
      if (!link) return;
      if (entry.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0.01 }
);

document.querySelectorAll('main section[id]').forEach(sec => observer.observe(sec));

document.querySelectorAll('.copy').forEach(btn => {
  btn.addEventListener('click', async () => {
    const target = document.querySelector(btn.dataset.copy);
    const text = target?.innerText || '';
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = original), 1200);
    } catch {
      btn.textContent = 'Copy failed';
      setTimeout(() => (btn.textContent = 'Copy'), 1200);
    }
  });
});
