(() => {
  const mainImage = document.getElementById("mainProductImage");
  const thumbnails = document.querySelectorAll("[data-product-image]");

  if (mainImage) {
    thumbnails.forEach((button) => {
      button.addEventListener("click", () => {
        mainImage.src = button.dataset.productImage;
        mainImage.alt = button.dataset.productAlt;

        thumbnails.forEach((thumbnail) => {
          thumbnail.setAttribute(
            "aria-pressed",
            String(thumbnail === button),
          );
        });
      });
    });
  }

  const variantSelect = document.getElementById("productVariant");
  const sizeSelect = document.getElementById("productSize");
  const flavourSelect = document.getElementById("productFlavour");
  const flavourGroup = document.getElementById("productFlavourGroup");
  const separateOptions = document.getElementById("separateProductOptions");
  const combinedOptions = document.getElementById("combinedProductOptions");
  const stockMessage = document.getElementById("variantStock");
  const quantity = document.getElementById("productQuantity");
  const button = document.getElementById("addToCartButton");
  const price = document.getElementById("selectedProductPrice");
  const regularPrice = document.getElementById(
    "selectedProductRegularPrice",
  );

  if (
    !variantSelect || !sizeSelect || !flavourSelect ||
    !flavourGroup || !separateOptions || !combinedOptions ||
    !stockMessage || !quantity || !button || !price || !regularPrice
  ) {
    return;
  }

  const money = new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  });

  const variants = [...variantSelect.options]
    .filter((option) => option.value)
    .map((option) => ({
      id: option.value,
      size: option.dataset.size,
      flavour: option.dataset.flavour,
      stock: Number(option.dataset.stock),
      price: Number(option.dataset.price),
      salePrice: option.dataset.salePrice === ""
        ? null
        : Number(option.dataset.salePrice),
    }));

  // Preserve the working fallback if variant data is incomplete.
  if (
    variants.some((variant) =>
      !Number.isFinite(variant.price) ||
      variant.price <= 0 ||
      !Number.isInteger(variant.stock) ||
      (variant.salePrice !== null &&
        (!Number.isFinite(variant.salePrice) ||
          variant.salePrice <= 0 ||
          variant.salePrice >= variant.price))
    )
  ) {
    return;
  }

  const sizes = [...new Set(variants.map((variant) => variant.size))];
  let selectedVariant = null;

  function resetSelect(select, label) {
    select.replaceChildren(new Option(label, ""));
  }

  function updateQuantityState() {
    if (!selectedVariant) {
      button.disabled = true;
      return;
    }

    const count = Number(quantity.value);
    const maximum = Math.min(99, selectedVariant.stock);

    button.disabled =
      !Number.isInteger(count) ||
      count < 1 ||
      count > maximum;
  }

  function showVariant(variant) {
    selectedVariant = variant;
    variantSelect.value = variant?.id ?? "";

    if (!variant) {
      price.textContent = variants.length
        ? "Select an option"
        : "Currently unavailable";
      regularPrice.hidden = true;
      quantity.max = "99";
      stockMessage.textContent = variants.length
        ? "Choose an available size and flavour."
        : "No options are currently available.";
      button.disabled = true;
      button.textContent = "Add to Cart";
      return;
    }

    price.textContent = money.format(variant.salePrice ?? variant.price);
    regularPrice.textContent = money.format(variant.price);
    regularPrice.hidden = variant.salePrice === null;

    quantity.max = String(Math.min(99, variant.stock));
    stockMessage.textContent = variant.stock > 0
      ? `${variant.stock} available for this option.`
      : "This option is out of stock.";

    button.textContent = variant.stock > 0
      ? "Add to Cart"
      : "Out of Stock";

    updateQuantityState();
  }

  function availableForSize() {
    if (!sizeSelect.value) return [];

    const index = Number(sizeSelect.value) - 1;

    return variants.filter((variant) => variant.size === sizes[index]);
  }

  function chooseFlavour() {
    const variant = availableForSize().find(
      (item) => item.flavour === flavourSelect.value && item.stock > 0,
    );

    showVariant(variant ?? null);
  }

  function chooseSize() {
    const matches = availableForSize();
    const flavours = [...new Set(matches.map((variant) => variant.flavour))];

    resetSelect(
      flavourSelect,
      matches.length ? "Choose a flavour" : "Choose a size first",
    );

    flavours.forEach((flavour) => {
      const inStock = matches.some(
        (variant) => variant.flavour === flavour && variant.stock > 0,
      );

      const option = new Option(
        `${flavour}${inStock ? "" : " — Out of stock"}`,
        flavour,
      );

      option.disabled = !inStock;
      flavourSelect.add(option);
    });

    const noFlavourChoice =
      flavours.length === 1 &&
      ["unflavoured", "standard"].includes(
        flavours[0].trim().toLowerCase(),
      );

    flavourGroup.hidden = noFlavourChoice;
    flavourSelect.disabled = matches.length === 0;

    if (noFlavourChoice) {
      flavourSelect.value = flavours[0];
      chooseFlavour();
    } else {
      showVariant(null);
    }
  }

  resetSelect(sizeSelect, "Choose a size");

  sizes.forEach((size, index) => {
    const inStock = variants.some(
      (variant) => variant.size === size && variant.stock > 0,
    );

    const option = new Option(
      `${size || "Size not specified"}${inStock ? "" : " — Out of stock"}`,
      String(index + 1),
    );

    option.disabled = !inStock;
    sizeSelect.add(option);
  });

  sizeSelect.addEventListener("change", chooseSize);
  flavourSelect.addEventListener("change", chooseFlavour);
  quantity.addEventListener("input", updateQuantityState);

  variantSelect.form.addEventListener("submit", (event) => {
    updateQuantityState();

    if (button.disabled || !selectedVariant) {
      event.preventDefault();
      stockMessage.textContent =
        "Choose an available option and a quantity within its stock limit.";
    }
  });

  // Reveal separate selectors only after setup succeeds.
  chooseSize();
  separateOptions.hidden = false;
  combinedOptions.hidden = true;
})();