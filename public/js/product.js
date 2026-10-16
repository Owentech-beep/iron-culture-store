const mainImage = document.getElementById("mainProductImage");
const thumbnails = document.querySelectorAll("[data-product-image]");
const flavourSelect = document.getElementById("productFlavour");
const variantStock = document.getElementById("variantStock");

if (flavourSelect && variantStock) {
  flavourSelect.addEventListener("change", () => {
    const selected = flavourSelect.selectedOptions[0];

    if (!flavourSelect.value) {
      variantStock.textContent = "";
      return;
    }

    const stock = Number(selected.dataset.stock);

    variantStock.textContent =
      stock > 0
        ? "Selected option is in stock."
        : "Selected option is out of stock.";
  });
}

if (mainImage) {
  thumbnails.forEach((button) => {
    button.addEventListener("click", () => {
      mainImage.src = button.dataset.productImage;
      mainImage.alt = button.dataset.productAlt;

      thumbnails.forEach((thumbnail) => {
        thumbnail.setAttribute(
          "aria-pressed",
          String(thumbnail === button)
        );
      });
    });
  });
}