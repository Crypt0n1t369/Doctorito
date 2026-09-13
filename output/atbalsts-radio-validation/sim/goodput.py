"""Frame-size choice: raw airtime favours big frames, error rate favours small
ones. This resolves it with the measured rates from experiment G."""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import capacity
GAP = 0.25
BURST = {85: 0.824, 128: 1.064, 170: 1.344, 255: 1.864}
BULLETIN = 1392                      # signed bytes of the real fixture

g = json.load(open("results_g.json"))
pts = sorted({(r["drr_db"], r["snr_db"]) for r in g}, reverse=True)
print(f"{'condition':<26} {'frame':>6} {'success':>8} {'goodput B/s':>12} "
      f"{'frames for 1392 B':>18} {'P(all in 1 pass)':>17} {'P(2 passes)':>12}")
print("-" * 106)
out = []
for drr, snr in pts:
    for pl in (85, 128, 170, 255):
        r = [x for x in g if x["drr_db"] == drr and x["snr_db"] == snr and x["payload"] == pl][0]
        d = capacity.frame_data_bytes(pl, False)
        slot = BURST[pl] + GAP
        s = r["rate"]
        gp = d * s / slot
        n = math.ceil(BULLETIN / d)
        p1 = s ** n
        p2 = (1 - (1 - s) ** 2) ** n
        out.append(dict(drr=drr, snr=snr, payload=pl, success=s, goodput=gp,
                        frames=n, p_one_pass=p1, p_two_pass=p2,
                        two_pass_s=round(2 * n * slot, 1)))
        print(f"{f'DRR {drr:+d}, SNR {snr:+d}':<26} {pl:>6} {s:>7.0%} {gp:>12.1f} "
              f"{n:>18} {p1:>16.0%} {p2:>11.0%}")
    print()
json.dump(out, open("results_goodput.json", "w"), indent=1)
print("P(2 passes) assumes independent repeats; experiment H measures how far "
      "that holds.")
