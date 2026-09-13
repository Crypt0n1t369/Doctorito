"""Independent HPKE implementation: Python cryptography, no custom crypto.

Ephemeral TEST keys arrive over stdin and are never written to disk.
Checks JS→Python and returns a Python→JS ciphertext for the exact app profile.
"""
import json
import sys
import cryptography
from cryptography.hazmat.primitives.hpke import Suite, KEM, KDF, AEAD
from cryptography.hazmat.primitives.asymmetric import x25519, ed25519

x = json.load(sys.stdin)
b = bytes.fromhex
s = Suite(KEM.X25519, KDF.HKDF_SHA256, AEAD.AES_128_GCM)
key = x25519.X25519PrivateKey.from_private_bytes(b(x['privateKey']))
envelope = b(x['envelope'])
info = b'atbalsts/report/v1\x00' + envelope[:10]
plain = s.decrypt(envelope[10:], key, info=info)
assert plain == b(x['paddedPlaintext'])
reverse = envelope[:10] + s.encrypt(plain, key.public_key(), info=info)
ed25519.Ed25519PublicKey.from_public_bytes(b(x['signPublicKey'])).verify(b(x['signature']), b(x['sigStructure']))
print(json.dumps({'cryptography': cryptography.__version__, 'hpke_js_to_python': True, 'ed25519_verified_in_python': True, 'pythonEnvelope': reverse.hex()}))
