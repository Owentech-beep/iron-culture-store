(() => {
  document.querySelectorAll(".brand-logo-upload").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const input = form.querySelector('input[name="logo"]');
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector(".brand-logo-upload-status");
      const csrfToken = form.querySelector('input[name="_csrf"]').value;
      const file = input.files[0];

      if (!file) {
        status.textContent = "Choose a logo first.";
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        status.textContent = "Choose a logo no larger than 5 MB.";
        return;
      }

      const body = new FormData();
      body.append("logo", file);

      button.disabled = true;
      form.setAttribute("aria-busy", "true");
      status.textContent = "Uploading logo…";

      try {
        const response = await fetch(form.action, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "X-CSRF-Token": csrfToken,
          },
          body,
        });

        if (response.redirected) {
          throw new Error("Your session may have expired. Refresh and sign in.");
        }

        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.imageUrl) {
          throw new Error(
            data?.error || "Upload failed. Refresh the page and try again.",
          );
        }

        const editor = form.closest(".brand-logo-editor");
        const preview = editor.querySelector("[data-brand-logo-preview]");
        const placeholder = editor.querySelector(
          "[data-brand-logo-placeholder]",
        );

        preview.src = data.imageUrl;
        preview.hidden = false;
        placeholder.hidden = true;

        input.value = "";
        status.textContent = "Brand logo saved.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
        form.removeAttribute("aria-busy");
      }
    });
  });
})();