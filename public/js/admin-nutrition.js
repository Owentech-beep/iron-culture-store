document.querySelectorAll("[data-nutrition-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector("[data-upload-status]");
    const fileInput = form.querySelector('input[type="file"]');
    const file = fileInput?.files[0];

    if (fileInput && !file) {
      status.textContent = "Choose a label image first.";
      return;
    }

    if (file && file.size > 5 * 1024 * 1024) {
      status.textContent = "The image must be no larger than 5 MB.";
      return;
    }

    const body = new FormData();

    if (file) body.append("image", file);

    button.disabled = true;
    status.textContent = file ? "Uploading nutrition label..." : "Removing label...";

    try {
      const response = await fetch(form.action, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-csrf-token": form.dataset.csrf,
          Accept: "application/json",
        },
        ...(file ? { body } : {}),
      });

      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Refresh the page and check that you are still signed in.");
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "The update could not be completed.");
      }

      window.location.reload();
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
});