import { animate } from 'animejs/animation';

/** Scroll seeks a paused Anime.js animation; there is no idle animation loop. */
export function mountCareerMotion(timeline: HTMLElement): () => void {
  const stages = [...timeline.querySelectorAll<HTMLElement>('.career-stage')];
  const markers = stages.map(stage => stage.querySelector<HTMLElement>('.milestone')!);
  const rails = stages.slice(0, -1).map(stage => stage.querySelector<SVGSVGElement>('.timeline-connector')!);
  const phase = { value: 0 };
  const wave = animate(phase, { value: [0, Math.PI * 8], duration: 1000, ease: 'linear', autoplay: false });
  let alive = true;
  let transitions: ReturnType<typeof animate>[] = [];
  let centers: number[] = [];
  let frame = 0;
  let visible = true;
  let needsMeasure = true;
  let current = -1;
  let hovered = -1;
  let focused = -1;
  let selected = '';
  const mobile = matchMedia('(max-width: 800px)');
  const hover = matchMedia('(hover: hover)');
  const clamp = (value: number) => Math.max(0, Math.min(1, value));

  const emphasize = () => {
    const engaged = focused >= 0 ? focused : hovered;
    const forward = engaged >= 0 ? engaged : current;
    const key = `${forward}:${engaged}`;
    if (key === selected) return;
    selected = key;
    transitions.forEach(animation => animation.cancel());
    transitions = stages.map((stage, index) => {
      stage.classList.toggle('is-current', index === forward);
      return animate(stage, {
        '--chapter-depth': index === forward ? 1 : 0,
        opacity: engaged >= 0 && index !== engaged ? .88 : 1,
        duration: 280,
        ease: 'outCubic',
      });
    });
  };

  const update = () => {
    frame = 0;
    // Read stable layout boxes, never the transformed text or marker rectangles.
    if (needsMeasure) {
      centers = stages.map((stage, i) => stage.getBoundingClientRect().top + scrollY + markers[i].offsetTop + markers[i].offsetHeight / 2);
      needsMeasure = false;
    }
    const origin = centers[0];
    const end = centers.at(-1)!;
    const progress = clamp((scrollY + innerHeight * .45 - origin) / Math.max(1, end - origin));
    wave.seek(progress * 1000, true);
    const amplitude = mobile.matches ? 5 : 25;
    const frequency = 2 * Math.PI / (mobile.matches ? 1400 : 1100);
    const x = (y: number) => amplitude * Math.sin((y - origin) * frequency - phase.value);
    const slope = (y: number) => amplitude * frequency * Math.cos((y - origin) * frequency - phase.value);
    const number = (value: number) => value.toFixed(2);
    const readingLine = scrollY + innerHeight * .45;
    current = 0;
    centers.forEach((center, index) => { if (center <= readingLine) current = index; });
    stages.forEach((stage, index) => {
      markers[index].style.setProperty('--wave-x', `${x(centers[index])}px`);
      if (centers[index] < scrollY + innerHeight * .92) stage.classList.add('is-seen');
    });
    rails.forEach((rail, index) => {
      const start = centers[index];
      const height = centers[index + 1] - start;
      const steps = Math.min(40, Math.max(1, Math.ceil(height / 180)));
      const segment = height / steps;
      let path = `M${number(x(start))} 0`;
      for (let step = 0; step < steps; step++) {
        const a = start + segment * step;
        const b = a + segment;
        path += ` C${number(x(a) + slope(a) * segment / 3)} ${number(a - start + segment / 3)} ${number(x(b) - slope(b) * segment / 3)} ${number(b - start - segment / 3)} ${number(x(b))} ${number(b - start)}`;
      }
      rail.setAttribute('viewBox', `${mobile.matches ? '-16 0 32' : '-64 0 128'} ${height}`);
      rail.style.height = `${height}px`;
      rail.querySelectorAll('path').forEach(line => line.setAttribute('d', path));
      rail.style.setProperty('--line-offset', String(1 - clamp((scrollY + innerHeight * .72 - start) / height)));
    });
    emphasize();
  };
  const schedule = () => { if (visible && !frame) frame = requestAnimationFrame(update); };
  const measure = () => { needsMeasure = true; schedule(); };
  const indexOf = (target: EventTarget | null) => target instanceof Element ? stages.indexOf(target.closest<HTMLElement>('.career-stage')!) : -1;
  const pointer = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !hover.matches) return;
    hovered = indexOf(event.target);
    emphasize();
  };
  const leave = () => { hovered = -1; emphasize(); };
  const focus = () => { if (!alive) return; focused = indexOf(document.activeElement); emphasize(); };
  const blur = () => { queueMicrotask(focus); };
  const resize = new ResizeObserver(measure);
  resize.observe(timeline);
  const visibility = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (visible) measure();
    else if (frame) { cancelAnimationFrame(frame); frame = 0; }
  }, { rootMargin: '100px' });
  visibility.observe(timeline);
  timeline.dataset.motion = 'true';
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure);
  timeline.addEventListener('toggle', measure, true);
  timeline.addEventListener('load', measure, true);
  timeline.addEventListener('pointerover', pointer);
  timeline.addEventListener('pointerleave', leave);
  timeline.addEventListener('focusin', focus);
  timeline.addEventListener('focusout', blur);
  focus();
  measure();

  return () => {
    alive = false;
    cancelAnimationFrame(frame);
    resize.disconnect();
    visibility.disconnect();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', measure);
    timeline.removeEventListener('toggle', measure, true);
    timeline.removeEventListener('load', measure, true);
    timeline.removeEventListener('pointerover', pointer);
    timeline.removeEventListener('pointerleave', leave);
    timeline.removeEventListener('focusin', focus);
    timeline.removeEventListener('focusout', blur);
    wave.revert();
    transitions.forEach(animation => animation.cancel());
    timeline.dataset.motion = 'false';
    stages.forEach((stage, i) => {
      stage.classList.remove('is-current', 'is-seen');
      stage.style.removeProperty('--chapter-depth');
      stage.style.removeProperty('opacity');
      markers[i].style.removeProperty('--wave-x');
    });
    rails.forEach(rail => {
      rail.setAttribute('viewBox', '-64 0 128 100');
      rail.style.removeProperty('height');
      rail.style.removeProperty('--line-offset');
      rail.querySelectorAll('path').forEach(path => path.setAttribute('d', 'M0 0 V100'));
    });
  };
}
