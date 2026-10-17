import { getCartCount } from "../models/Cart.js";

export async function loadCartCount(req, res, next) {
  res.locals.cartCount = req.user
    ? await getCartCount(req.user.id)
    : 0;

  next();
}