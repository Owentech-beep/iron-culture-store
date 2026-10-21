import { randomUUID } from "node:crypto";

export function createSlug(name, maxLength = 120) {
  const suffix = randomUUID();

  const base = String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const prefix = (base || "item")
    .slice(0, maxLength - suffix.length - 1)
    .replace(/-+$/g, "");

  return `${prefix}-${suffix}`;
}