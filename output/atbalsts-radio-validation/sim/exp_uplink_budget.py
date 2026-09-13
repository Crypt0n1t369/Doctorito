import sys, numpy as np
sys.path.insert(0,"/Users/kristaps/Documents/New project/output/atbalsts-radio-validation/sim")
import modem as M
FS=M.FS
def tune(c,bw):
    M.CENTRE_HZ=c; M.CHIRP_F0,M.CHIRP_F1=c-bw*0.65,c+bw*0.65; M.CHIRP=M._chirp()
    M.set_fft(512,64,bw); M.set_mode("time")
def airtime(nbytes,bw,c=1500.):
    tune(c,bw); return M.modulate(bytes(nbytes)).size/FS

HDR=4; REC=5
PTT=0.35   # key-up + squelch-open + de-bounce on a real handheld

print("Field report = 1 shelter: id + state + free places + revision = 5 bytes\n")
print(f"{'what is sent':<44}{'bytes':>6}{'air':>8}{'+PTT':>8}")
for label, auth, nrec in [
    ("1 report, Ed25519 signature (as v1 broadcast)", 64, 1),
    ("1 report, 8-byte MAC per station",               8, 1),
    ("6 reports batched, 8-byte MAC",                  8, 6),
    ("20 reports batched, 8-byte MAC",                 8, 20),
    ("20 reports batched, Ed25519",                   64, 20)]:
    n = HDR + REC*nrec + auth
    t = airtime(n, 1650.)
    print(f"{label:<44}{n:>6}{t:>7.2f}s{t+PTT:>7.2f}s")

print("\nOne 12.5 kHz channel, stations taking turns (full 1650 Hz audio):")
for nrec, auth, lbl in [(1,8,"1 report"),(6,8,"6 batched"),(20,8,"20 batched")]:
    t = airtime(HDR+REC*nrec+auth, 1650.)+PTT
    print(f"  {lbl:<12} {t:5.2f} s/turn -> {3600/t*nrec:7.0f} reports/hour "
          f"if the channel is 100% busy")
    print(f"  {'':<12} {'':5}    -> {3600/t*nrec*0.18:7.0f} reports/hour at 18% "
          f"(realistic ALOHA-style loading)")

print("\nSame channel split into 4 slices, all 4 transmitting at once:")
t4 = airtime(HDR+REC*6+8, 450.)+PTT
print(f"  6 batched reports per slice: {t4:.2f} s -> "
      f"{4*6*3600/t4:.0f} reports/hour if all slices stay busy")
print(f"  but this needs 4 separate receivers or one SDR, and fails when")
print(f"  station strengths differ by more than ~20 dB (measured above)")
