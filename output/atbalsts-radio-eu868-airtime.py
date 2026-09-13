#!/usr/bin/env python3
"""Illustrative EU868 LoRaWAN uplink airtime for the Atbalsts pilot.

Assumptions: 125 kHz, CR 4/5, explicit header, PHY CRC, 8-symbol preamble,
no FOpts, 13-byte LoRaWAN PHY overhead, 8-byte application fragment header.
Uplinks use one 1% duty-cycle sub-band; the illustrative receipt uses one
10% sub-band. There is no loss or retry. Printed spacing is a best-case
scheduling bound, not a delivery SLA.
"""

from math import ceil


DATA_RATES = {
    "DR0 / SF12": (12, 51),
    "DR3 / SF9": (9, 115),
    "DR5 / SF7": (7, 222),
}


def airtime_seconds(phy_payload_bytes: int, spreading_factor: int) -> float:
    bandwidth_hz = 125_000
    symbol_seconds = (2**spreading_factor) / bandwidth_hz
    low_data_rate_optimization = int(symbol_seconds >= 0.016)
    coding_rate_index = 1  # CR 4/5
    numerator = 8 * phy_payload_bytes - 4 * spreading_factor + 28 + 16
    denominator = 4 * (spreading_factor - 2 * low_data_rate_optimization)
    payload_symbols = 8 + max(ceil(numerator / denominator) * (coding_rate_index + 4), 0)
    return (8 + 4.25 + payload_symbols) * symbol_seconds


def estimate(object_bytes: int, spreading_factor: int, max_application_bytes: int, duty_cycle: float = 0.01):
    useful_per_fragment = max_application_bytes - 8
    fragments = []
    remaining = object_bytes
    while remaining:
        useful = min(remaining, useful_per_fragment)
        fragments.append(airtime_seconds(13 + 8 + useful, spreading_factor))
        remaining -= useful
    total_airtime = sum(fragments)
    # On a single sub-band, each packet except the last imposes an off-time.
    earliest_finish = sum(duration / duty_cycle for duration in fragments[:-1]) + fragments[-1]
    return len(fragments), total_airtime, earliest_finish


if __name__ == "__main__":
    print("Object  Data rate   Frames  Tx airtime  Earliest finish, one 1% sub-band")
    for object_size in (128, 314, 1024):
        for name, (sf, max_payload) in DATA_RATES.items():
            frames, airtime, earliest = estimate(object_size, sf, max_payload)
            finish_text = f"{earliest:.2f} s" if earliest < 60 else f"{earliest / 60:.2f} min"
            print(f"{object_size:>6}  {name:<10}  {frames:>6}  {airtime:>8.2f} s  {finish_text:>10}")

    print("\n105-byte signed receipt on one 10% downlink sub-band (illustrative):")
    frames, airtime, earliest = estimate(105, 12, 51, 0.10)
    print(f"DR0 / SF12 fragmented: {frames} frames, {airtime:.2f} s airtime, {earliest:.2f} s earliest finish")
    # FPort 11 carries the entire receipt without the 8-byte fragment header.
    whole_airtime = airtime_seconds(13 + 105, 9)
    print(f"DR3 / SF9 whole: 1 frame, {whole_airtime:.2f} s airtime, {whole_airtime:.2f} s earliest finish")
