document.querySelectorAll("[data-home-slideshow]").forEach((gallery) => {
  const slides = [...gallery.querySelectorAll("[data-home-slide]")];
  const controls = gallery.querySelector("[data-slide-controls]");
  const toggle = gallery.querySelector("[data-slide-toggle]");
  const counter = gallery.querySelector("[data-slide-counter]");

  if (!slides.length || !controls || !toggle || !counter) return;

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );

  let currentIndex = 0;
  let timer = null;
  let paused = reducedMotion.matches;
  let pointerInside = false;
  let focusInside = false;

  function stopTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function videoIsPlaying() {
    const video = slides[currentIndex].querySelector("video");
    return Boolean(video && !video.paused && !video.ended);
  }

  function scheduleNext() {
    stopTimer();

    if (
      slides.length < 2 ||
      paused ||
      pointerInside ||
      focusInside ||
      document.hidden ||
      videoIsPlaying()
    ) {
      return;
    }

    timer = setTimeout(() => {
      showSlide(currentIndex + 1);
    }, 5000);
  }

  function updateToggle() {
    toggle.textContent = paused ? "Play slideshow" : "Pause slideshow";
  }

  function showSlide(index) {
    stopTimer();

    currentIndex = (index + slides.length) % slides.length;

    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === currentIndex;

      slide.hidden = !active;

      if (!active) {
        slide.querySelectorAll("video").forEach((video) => {
          video.pause();
        });
      }
    });

    counter.textContent = `${currentIndex + 1} / ${slides.length}`;
    scheduleNext();
  }

  toggle.addEventListener("click", () => {
    paused = !paused;
    updateToggle();
    scheduleNext();
  });

  gallery.addEventListener("mouseenter", () => {
    pointerInside = true;
    stopTimer();
  });

  gallery.addEventListener("mouseleave", () => {
    pointerInside = false;
    scheduleNext();
  });

  gallery.addEventListener("focusin", () => {
    focusInside = true;
    stopTimer();
  });

  gallery.addEventListener("focusout", (event) => {
    focusInside = gallery.contains(event.relatedTarget);
    scheduleNext();
  });

  gallery.querySelectorAll("video").forEach((video) => {
    video.addEventListener("play", stopTimer);
    video.addEventListener("pause", scheduleNext);
    video.addEventListener("ended", scheduleNext);
  });

  document.addEventListener("visibilitychange", scheduleNext);

  reducedMotion.addEventListener("change", (event) => {
    if (event.matches) {
      paused = true;
      updateToggle();
      scheduleNext();
    }
  });

  // Keep photo swiping available on mobile.
  let touchStart = null;

  gallery.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || event.target.tagName !== "IMG") {
      touchStart = null;
      return;
    }

    stopTimer();

    touchStart = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    };
  }, { passive: true });

  gallery.addEventListener("touchend", (event) => {
    if (!touchStart || !event.changedTouches.length) return;

    const dx = event.changedTouches[0].clientX - touchStart.x;
    const dy = event.changedTouches[0].clientY - touchStart.y;

    touchStart = null;

    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
      showSlide(currentIndex + (dx < 0 ? 1 : -1));
    } else {
      scheduleNext();
    }
  }, { passive: true });

  gallery.addEventListener("touchcancel", () => {
    touchStart = null;
    scheduleNext();
  }, { passive: true });

  // Avoid announcing an automatic change every five seconds.
  counter.setAttribute("aria-live", "off");

  controls.hidden = slides.length < 2;
  updateToggle();
  showSlide(0);
});