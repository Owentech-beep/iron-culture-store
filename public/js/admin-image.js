const uploadForm = document.getElementById("mainImageUpload");

if (uploadForm) {
  const fileInput = document.getElementById("mainImageFile");
  const status = document.getElementById("imageUploadStatus");
  const button = uploadForm.querySelector('button[type="submit"]');

  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

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
          "Upload could not be completed. Refresh the page and check that you are still signed in as an admin."
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
}