/* Ed25519 channel keys.
 *
 * Private keys are generated here and never leave the server. A receiver only
 * ever gets the 32-byte public key, which it pins. Rotation issues a new key id
 * and retires the old one; receivers keep both until every transmitter has
 * moved, because a broadcast has no return channel to coordinate a cutover.
 */

import crypto from "node:crypto";

export function generateChannelKey(keyId) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    keyId,
    publicPem: publicKey.export({ type: "spki", format: "pem" }),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicRaw: rawPublicKey(publicKey).toString("hex"),
  };
}

/** The 32 raw bytes at the end of an Ed25519 SPKI DER encoding. */
export function rawPublicKey(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}

export function signWith(privatePem) {
  const key = crypto.createPrivateKey(privatePem);
  return bytes => new Uint8Array(crypto.sign(null, Buffer.from(bytes), key));
}

export function verifyWith(publicPem) {
  const key = crypto.createPublicKey(publicPem);
  return (bytes, signature) => crypto.verify(null, Buffer.from(bytes), key, Buffer.from(signature));
}

/** Verify against a raw 32-byte hex public key, as a receiver would. */
export function verifyRaw(publicRawHex, bytes, signature) {
  const der = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(publicRawHex, "hex"),
  ]);
  const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  return crypto.verify(null, Buffer.from(bytes), key, Buffer.from(signature));
}
