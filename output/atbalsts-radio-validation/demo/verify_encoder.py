"""Compare JavaScript TX samples with the independent original Python modem."""
import json
import sys
import numpy as np
import modem_demo as modem

data = json.load(open(sys.argv[1]))
payload = bytes.fromhex(data["payload"])
actual = np.array(data["samples"])
expected = modem.modulate(payload)
assert actual.shape == expected.shape
error = float(np.max(np.abs(actual - expected)))
assert error < 1e-10, error
print(f"PASS JavaScript encoder matches original Python waveform (max sample error {error:.3g})")
