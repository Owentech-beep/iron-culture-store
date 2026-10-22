import { BlockList, isIP } from "node:net";

const payfastAddresses = new BlockList();

payfastAddresses.addSubnet("197.97.145.144", 28, "ipv4");
payfastAddresses.addSubnet("41.74.179.192", 27, "ipv4");
payfastAddresses.addSubnet("102.216.36.0", 28, "ipv4");
payfastAddresses.addSubnet("102.216.36.128", 28, "ipv4");
payfastAddresses.addAddress("144.126.193.139", "ipv4");

function normaliseIp(value) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();

  return trimmed.startsWith("::ffff:")
    ? trimmed.slice(7)
    : trimmed;
}

export function requirePayfastSource(req, res, next) {
  res.set("Cache-Control", "no-store");

  const mode = process.env.PAYFAST_MODE?.trim();

  if (!["sandbox", "live"].includes(mode)) {
    return res.status(503).type("text/plain").send(
      "Payment notifications are not configured.",
    );
  }

  let sender;

  if (
    process.env.NODE_ENV === "production" &&
    process.env.RENDER === "true"
  ) {
    // For this Render public web service, Cloudflare supplies this header.
    // Never fall back to a caller-controlled forwarded-IP chain.
    sender = normaliseIp(req.get("cf-connecting-ip"));
  } else if (
    process.env.NODE_ENV === "development" &&
    mode === "sandbox"
  ) {
    // Preserve the existing local sandbox tunnel setup.
    const peer = normaliseIp(req.socket.remoteAddress);

    if (!["127.0.0.1", "::1"].includes(peer)) {
      return res.status(403).type("text/plain").send(
        "Untrusted notification connection.",
      );
    }

    const forwarded = req.get("x-forwarded-for");

    sender = normaliseIp(
      typeof forwarded === "string"
        ? forwarded.split(",").at(-1)
        : "",
    );
  } else {
    return res.status(503).type("text/plain").send(
      "Payment notifications are unavailable in this environment.",
    );
  }

  if (
    isIP(sender) !== 4 ||
    !payfastAddresses.check(sender, "ipv4")
  ) {
    return res.status(403).type("text/plain").send(
      "Untrusted notification source.",
    );
  }

  // Disabling new checkout attempts must not block confirmations
  // for payments already in progress.
  next();
}