"""Analytical checks for the Atbalsts architecture memo, not RF measurements.

Run with Python 3. Standard library only. Decimal byte units throughout.
LoRa airtime follows the standard explicit-header LoRa packet formula.
"""
import json
import math


def lora_airtime(payload_bytes, sf=11, bandwidth_hz=250000,
                 coding_rate_denominator=5, preamble_symbols=8,
                 crc=True, implicit_header=False, low_data_rate_optimization=False):
    symbol_seconds = (2 ** sf) / bandwidth_hz
    numerator = 8 * payload_bytes - 4 * sf + 28 + 16 * int(crc) - 20 * int(implicit_header)
    denominator = 4 * (sf - 2 * int(low_data_rate_optimization))
    payload_symbols = 8 + max(math.ceil(numerator / denominator) * coding_rate_denominator, 0)
    return (preamble_symbols + 4.25 + payload_symbols) * symbol_seconds


pilot_items = {
    "six_complete_lora_kits": [6 * 60, 6 * 100],
    "two_local_gateway_hosts_and_wifi": [2 * 120, 2 * 220],
    "power_and_adapters": [200, 350],
    "audio_receivers_and_cables": [60, 140],
    "mounts_spares_and_local_travel": [150, 300],
}
pilot_subtotal = [sum(v[i] for v in pilot_items.values()) for i in [0, 1]]
municipal_subtotal = [20000 + 80 * 400 + 10000, 50000 + 160 * 700 + 25000]
national_subtotal = [500 * 500 + 20 * 2500 + 100000 + 200000,
                     500 * 1200 + 20 * 6000 + 250000 + 450000]
result = {
    "warning": "Calculated scenarios only. No hardware, radio, acoustic, or phone tests performed.",
    "transfer_seconds_at_10_and_30_bit_per_second": {
        str(n): [8 * n / rate for rate in [10, 30]] for n in [64, 160, 1000, 100000, 1000000]
    },
    "example_lora_200_byte_frame_airtime_seconds": lora_airtime(200),
    "two_second_frames_per_hour_at_1_and_10_percent_duty_cycle": [18, 180],
    "unique_bulletins_three_transmissions_each_at_1_and_10_percent": [6, 60],
    "ideal_hexagonal_sites_for_64600_square_km": {
        str(radius): math.ceil(64600 / ((3 * math.sqrt(3) / 2) * radius ** 2))
        for radius in [3, 5, 10, 15]
    },
    "three_watt_gateway_72_hour_battery_wh_at_80_percent_usable": 3 * 72 / .8,
    "twenty_thousand_mah_3_7v_powerbank_hours_at_three_watts_and_80_percent_usable": 20 * 3.7 * .8 / 3,
    "pilot_eur_ex_vat": {
        "items": pilot_items,
        "subtotal": pilot_subtotal,
        "with_20_percent_contingency": [v * 1.2 for v in pilot_subtotal],
        "development_25_to_50_days_at_400_to_700_eur": [25 * 400, 50 * 700],
    },
    "municipal_eur_with_20_percent_contingency": [v * 1.2 for v in municipal_subtotal],
    "national_500_service_points_eur_with_20_percent_contingency": [v * 1.2 for v in national_subtotal],
}
print(json.dumps(result, indent=2))
