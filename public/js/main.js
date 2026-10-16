const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

if (window.AOS) {
  window.AOS.init({
    duration: 650,
    easing: "ease-out",
    once: true,
    offset: 40,
    disable: prefersReducedMotion,
  });
}