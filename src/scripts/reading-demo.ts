export function enhanceReadingDemo(example: HTMLDetailsElement): void {
  const input = example.querySelector<HTMLInputElement>('input');
  const status = example.querySelector<HTMLElement>('[data-estimate]');
  const controls = example.querySelector<HTMLElement>('[data-controls]');
  if (!input || !status || !controls) return;
  const update = () => {
    if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) { status.textContent = 'Enter a whole word count between 1 and 100,000.'; return; }
    const minutes = Math.ceil(input.valueAsNumber / 220);
    status.textContent = `Estimated reading time: ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  };
  input.addEventListener('input', update); update(); controls.hidden = false;
  const fallback = example.querySelector<HTMLElement>('[data-fallback]'); if (fallback) fallback.hidden = true;
}
