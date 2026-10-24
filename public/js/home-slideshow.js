document.querySelectorAll("[data-home-slideshow]").forEach((gallery) => {
  const slides = [...gallery.querySelectorAll("[data-home-slide]")];
  const controls = gallery.querySelector("[data-slide-controls]");
  const previous = gallery.querySelector("[data-slide-previous]");
  const next = gallery.querySelector("[data-slide-next]");
  const counter = gallery.querySelector("[data-slide-counter]");

  if (!slides.length) return;

  let currentIndex = 0;

  function showSlide(index) {
    currentIndex = (index + slides.length) % slides.length;

    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === currentIndex;

      if (!active) {
        slide.querySelectorAll("video").forEach((video) => {
          video.pause();
        });
      }

      slide.hidden = !active;
    });

    counter.textContent = `${currentIndex + 1} / ${slides.length}`;
  }

  previous.addEventListener("click", () => {
    showSlide(currentIndex - 1);
  });

  next.addEventListener("click", () => {
    showSlide(currentIndex + 1);
  });

  // Swipe on photos. Video touches remain available for playback controls.
  let touchStart = null;

  gallery.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || event.target.tagName !== "IMG") {
      touchStart = null;
      return;
    }

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
    }
  }, { passive: true });

  gallery.addEventListener("touchcancel", () => {
    touchStart = null;
  }, { passive: true });

  showSlide(0);
  controls.hidden = slides.length < 2;
});