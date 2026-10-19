(() => {
  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function initialiseAnimations() {
    // Entrance animations are limited to the homepage.
    if (
      window.location.pathname !== "/" ||
      reducedMotion.matches ||
      !window.AOS
    ) {
      return;
    }
    try {
      root.classList.add("aos-enabled");

      // Establish the initial animation styles before AOS reveals the hero.
      const firstAnimatedElement = document.querySelector("[data-aos]");

      if (firstAnimatedElement) {
        void firstAnimatedElement.offsetHeight;
      }

      window.AOS.init({
        duration: 650,
        easing: "ease-out",
        once: true,
        mirror: false,
        offset: 40,
      });

      window.AOS.refresh();
    } catch {
      root.classList.remove("aos-enabled");
      console.warn("Scroll animations unavailable; content remains visible.");
    }
  }

  // Keyboard users must never focus an invisible product link.
  document.addEventListener("focusin", (event) => {
    if (!(event.target instanceof Element)) return;

    const animatedParent = event.target.closest("[data-aos]");

    if (animatedParent) {
      animatedParent.classList.add("aos-animate");
    }
  });

  reducedMotion.addEventListener("change", (event) => {
    if (event.matches) {
      root.classList.remove("aos-enabled");
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseAnimations, {
      once: true,
    });
  } else {
    initialiseAnimations();
  }
})();
