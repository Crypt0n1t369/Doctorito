#!/usr/bin/env python3
"""Reproducible *planning* capacity model for Atbalsts private radio messages.

No RF loss, MAC options, retransmissions, voice interruption, broadcaster
processing or measured link availability is included. See the companion memo.
"""

from __future__ import annotations

import importlib.util
import json
from math import ceil, exp, floor
from pathlib import Path


HERE = Path(__file__).resolve().parent
measurements = json.loads(
    (HERE / "atbalsts-radio-security-proof" / "results.json").read_text()
)["measurements"]
audio_frame_seconds = (
    measurements["public-snapshot"]["wavSeconds"]
    - measurements["sealed-report"]["wavSeconds"]
) / (
    measurements["public-snapshot"]["repeats"]
    * (measurements["public-snapshot"]["framesPerPass"]
       - measurements["sealed-report"]["framesPerPass"])
)
audio_lead_seconds = (
    measurements["public-snapshot"]["wavSeconds"]
    - measurements["public-snapshot"]["repeats"]
    * measurements["public-snapshot"]["framesPerPass"]
    * audio_frame_seconds
)
assert abs(audio_frame_seconds - 1.348) < 1e-9
assert abs(audio_lead_seconds - 0.5) < 1e-9

spec = importlib.util.spec_from_file_location(
    "atbalsts_airtime", HERE / "atbalsts-radio-eu868-airtime.py"
)
assert spec and spec.loader
airtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(airtime)


def cbor_head_bytes(size: int) -> int:
    if size < 24:
        return 1
    if size < 256:
        return 2
    if size < 65536:
        return 3
    raise ValueError("Model intentionally limited to small messages")


def cose_sign1_bytes(payload_bytes: int) -> int:
    # Measured for a 4-byte kid, empty unprotected map, 64-byte Ed25519 sig.
    return payload_bytes + 79 + cbor_head_bytes(payload_bytes)


def hybrid_one_content_many_users(recipients: int) -> int:
    # Illustrative, not a final wire spec: 12 B header + 12 B nonce + 64 B
    # padded content + 16 B AEAD tag, plus 4 B opaque hint + 32 B X25519
    # encapsulation + 32 B content key + 16 B AEAD tag per recipient.
    payload = 104 + 84 * recipients
    return cose_sign1_bytes(payload)


def fm_frames(object_bytes: int) -> int:
    return ceil(object_bytes / 112)


def fm_case(slot_seconds: int, public_bytes: int = 378, private_bytes: int = 209) -> dict:
    unique_frames = floor((slot_seconds - audio_lead_seconds) / (2 * audio_frame_seconds))
    public_frames = fm_frames(public_bytes)
    private_frames = fm_frames(private_bytes)
    per_cycle = max(0, (unique_frames - public_frames) // private_frames)
    return {
        "slotSeconds": slot_seconds,
        "cyclesPerHour": 12,
        "unique112ByteFramesPerCycle": unique_frames,
        "publicObjectBytes": public_bytes,
        "publicFramesPerCycle": public_frames,
        "privateObjectBytes": private_bytes,
        "privateFramesPerObject": private_frames,
        "privateObjectsPerCycle": per_cycle,
        "privateObjectsPerHour": 12 * per_cycle,
    }


def lora_case(object_bytes: int, sf: int, maximum_application_bytes: int,
              duty_cycle: float) -> dict:
    frames, seconds, spacing = airtime.estimate(
        object_bytes, sf, maximum_application_bytes, duty_cycle
    )
    return {
        "objectBytes": object_bytes,
        "frames": frames,
        "txSeconds": round(seconds, 6),
        "firstObjectFinishBoundSeconds": round(spacing, 6),
        "hardAirtimeObjectsPerHour": floor(3600 * duty_cycle / seconds),
        "halfBudgetObjectsPerHour": floor(1800 * duty_cycle / seconds),
    }


def afsk_case(object_bytes: int) -> dict:
    # A licensed 1200 bit/s AFSK reference, illustrative assumptions only:
    # 20 B link framing, 5% bit stuffing, 0.3 s PTT/preamble/turnaround.
    tx_seconds = (object_bytes + 20) * 8 / 1200 * 1.05 + 0.3
    return {
        "objectBytes": object_bytes,
        "txSeconds": round(tx_seconds, 3),
        "tenPercentSharedChannelObjectsPerHour": floor(360 / tx_seconds),
        "tenPercentSharedChannelKilobytesPerHour": round(
            floor(360 / tx_seconds) * object_bytes / 1000, 1
        ),
    }


def contention_case(stations: int) -> dict:
    # Toy unslotted-ALOHA bound: each station sends 10 reports/hour, each
    # report has 2 DR3 fragments, 3 equally loaded channels, equal SF/power.
    offered_load_per_channel = stations * 10 * 0.964608 / (3 * 3600)
    return {
        "stations": stations,
        "aggregateReportsPerHour": stations * 10,
        "offeredLoadPerChannel": round(offered_load_per_channel, 6),
        "twoFragmentNoCollisionProbability": round(
            exp(-4 * offered_load_per_channel), 4
        ),
        "receiptDownlinkSecondsPerHour": round(stations * 10 * 0.64, 2),
    }


def main() -> None:
    signed_private_bytes = cose_sign1_bytes(128)
    assert signed_private_bytes == 209
    assert hybrid_one_content_many_users(5) == 606
    assert hybrid_one_content_many_users(10) == 1026
    fm = {str(seconds): fm_case(seconds) for seconds in (15, 30, 60)}
    uplink = {
        "DR0_SF12": lora_case(128, 12, 51, 0.01),
        "DR3_SF9": lora_case(128, 9, 115, 0.01),
        "DR5_SF7": lora_case(128, 7, 222, 0.01),
        "DR3_SF9_rich314": lora_case(314, 9, 115, 0.01),
        "DR3_SF9_signedPrivate209": lora_case(209, 9, 115, 0.01),
    }
    receipt_downlink = lora_case(105, 9, 115, 0.10)
    # Receipt fits whole in a DR3 frame, so remove the 8 B fragment header.
    receipt_downlink["frames"] = 1
    receipt_downlink["txSeconds"] = round(airtime.airtime_seconds(13 + 105, 9), 6)
    receipt_downlink["firstObjectFinishBoundSeconds"] = receipt_downlink["txSeconds"]
    receipt_downlink["hardAirtimeObjectsPerHour"] = floor(360 / receipt_downlink["txSeconds"])
    receipt_downlink["halfBudgetObjectsPerHour"] = floor(180 / receipt_downlink["txSeconds"])
    private_downlink = lora_case(signed_private_bytes, 9, 115, 0.10)
    gateway_guardrail_seconds = 36  # engineering target: <=1% wall-clock deaf time
    receipts_per_hour = 20
    receipt_seconds_per_hour = receipts_per_hour * receipt_downlink["txSeconds"]
    private_downlinks_after_receipts = floor(
        (gateway_guardrail_seconds - receipt_seconds_per_hour)
        / private_downlink["txSeconds"]
    )
    output = {
        "assumptions": {
            "fmCyclesPerHour": 12,
            "fmRepetitions": 2,
            "audioFrameObjectBytes": 112,
            "audioFrameSecondsIncludingGap": round(audio_frame_seconds, 3),
            "audioLeadSeconds": round(audio_lead_seconds, 3),
            "loraUplinkOnePercentSecondsPerHourPerDeviceSubband": 36,
            "gatewayTenPercentSubbandSecondsPerHour": 360,
            "gatewayPlanningGuardrailSecondsPerHour": gateway_guardrail_seconds,
        },
        "crypto": {
            "hpkeSealedBytes": 128,
            "signedHpkeSealedBytes": signed_private_bytes,
            "sameContentHybridFiveRecipientsBytes": hybrid_one_content_many_users(5),
            "sameContentHybridTenRecipientsBytes": hybrid_one_content_many_users(10),
            "signedSymmetricGroupBytes": cose_sign1_bytes(104),
        },
        "fm": fm,
        "loraUplink": uplink,
        "loraDownlink": {
            "receipt105DR3": receipt_downlink,
            "signedPrivate209DR3": private_downlink,
            "twentyReceiptsTxSecondsPerHour": round(receipt_seconds_per_hour, 3),
            "private209MessagesPerHourAfterTwentyReceiptsAtOnePercentGatewayOccupancy": private_downlinks_after_receipts,
            "receipt105DR0": lora_case(105, 12, 51, 0.10),
        },
        "licensed1200BaudAfskIllustration": {
            "sealed128": afsk_case(128),
            "signedPrivate209": afsk_case(209),
        },
        "toyThreeChannelSameSfAloha": [contention_case(n) for n in (2, 5, 10, 20)],
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
