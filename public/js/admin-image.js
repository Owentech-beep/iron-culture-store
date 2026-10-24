document
  .querySelectorAll("#mainImageUpload, #secondImageUpload")
  .forEach((uploadForm) => {
    const fileInput = uploadForm.querySelector('input[type="file"]');
    const status = uploadForm.querySelector('[role="status"]');
    const button = uploadForm.querySelector('button[type="submit"]');

    if (!fileInput || !status || !button) return;

    uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (button.disabled) return;

      const file = fileInput.files[0];

      if (!file) {
        status.textContent = "Choose an image first.";
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        status.textContent = "The image must be no larger than 5 MB.";
        return;
      }

      const body = new FormData();
      body.append("image", file);

      button.disabled = true;
      status.textContent = "Uploading and processing image...";

      try {
        const response = await fetch(uploadForm.action, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "x-csrf-token": uploadForm.dataset.csrf,
            Accept: "application/json",
          },
          body,
        });

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
          throw new Error(
            "Upload could not be completed. Refresh the page and check that you are still signed in as an admin.",
          );
        }

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Upload failed.");
        }

        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  document
  .querySelectorAll("[data-remove-product-image]")
  .forEach((form) => {
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[role="status"]');

    if (!button || !status || !form.dataset.csrf) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (button.disabled) return;

      button.disabled = true;
      status.textContent = "Removing image...";

      try {
        const response = await fetch(form.action, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "x-csrf-token": form.dataset.csrf,
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
          throw new Error(
            "Removal could not be completed. Refresh the page and check that you are still signed in as an admin.",
          );
        }

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Image removal failed.");
        }

        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });

    button.disabled = false;
  });