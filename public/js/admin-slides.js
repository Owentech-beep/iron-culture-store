const slideUploadForm = document.getElementById("homeSlideUpload");

if (slideUploadForm) {
  const fileInput = slideUploadForm.querySelector('input[type="file"]');
  const button = slideUploadForm.querySelector('button[type="submit"]');
  const status = slideUploadForm.querySelector('[role="status"]');

  slideUploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (button.disabled) return;

    const file = fileInput.files[0];

    if (!file) {
      status.textContent = "Choose an image or video.";
      return;
    }

    const isVideo = file.type === "video/mp4";
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
    ];

    if (!allowed.includes(file.type)) {
      status.textContent = "Use a JPEG, PNG, WebP image or MP4 video.";
      return;
    }

    const limit = (isVideo ? 20 : 5) * 1024 * 1024;

    if (file.size > limit) {
      status.textContent = isVideo
        ? "Videos must be no larger than 20 MB."
        : "Images must be no larger than 5 MB.";
      return;
    }

    const body = new FormData();
    body.append("media", file);

    button.disabled = true;
    status.textContent =
      "Uploading and processing. Videos can take longer; keep this page open.";

    try {
      const response = await fetch(slideUploadForm.action, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-csrf-token": slideUploadForm.dataset.csrf,
          Accept: "application/json",
        },
        body,
      });

      if (
        !(response.headers.get("content-type") || "")
          .includes("application/json")
      ) {
        throw new Error(
          "Upload failed. Refresh the page and check that you are signed in as an admin.",
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

  button.disabled = false;
}