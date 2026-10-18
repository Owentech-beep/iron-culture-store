import { BlockList, isIP } from "node:net";

const payfastAddresses = new BlockList();

payfastAddresses.addSubnet("197.97.145.144", 28, "ipv4");
payfastAddresses.addSubnet("41.74.179.192", 27, "ipv4");
payfastAddresses.addSubnet("102.216.36.0", 28, "ipv4");
payfastAddresses.addSubnet("102.216.36.128", 28, "ipv4");
payfastAddresses.addAddress("144.126.193.139", "ipv4");

function normaliseIp(value) {
  return value.startsWith("::ffff:")
    ? value.slice(7)
    : value;
}

export function requireLocalSandboxPayfastSource(req, res, next) {
  res.set("Cache-Control", "no-store");

  if (
    process.env.NODE_ENV !== "development" ||
    process.env.PAYFAST_MODE?.trim() !== "sandbox"
  ) {
    return res.status(503).type("text/plain").send(
      "Local sandbox notifications are not enabled."
    );
  }

  const peer = normaliseIp(req.socket.remoteAddress ?? "");

  if (!["127.0.0.1", "::1"].includes(peer)) {
    return res.status(403).type("text/plain").send(
      "Untrusted notification connection."
    );
  }

  const forwarded = req.get("x-forwarded-for");
  const sender = normaliseIp(
    forwarded?.split(",").at(-1)?.trim() ?? ""
  );

  if (
    isIP(sender) !== 4 ||
    !payfastAddresses.check(sender, "ipv4")
  ) {
    return res.status(403).type("text/plain").send(
      "Untrusted notification source."
    );
  }

  next();
}