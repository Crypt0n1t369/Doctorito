import numpy as np
TX, SLOT, CAPTURE_P = 0.89, 0.10, 0.45

def contention(n, window, seed, max_retry=20):
    """Free-for-all: everyone reports when they feel like it, CSMA + back-off."""
    r = np.random.default_rng(seed)
    pend = {i: {"t": r.uniform(0, window), "k": 0} for i in range(n)}
    done, lost, last = 0, 0, 0.0
    while pend:
        i, st = min(pend.items(), key=lambda kv: kv[1]["k"] and 0 or kv[1]["t"]) \
                if False else min(pend.items(), key=lambda kv: kv[1]["t"])
        t = st["t"]
        clash = [j for j, s in pend.items() if j != i and abs(s["t"]-t) < TX]
        if not clash:
            done += 1; last = max(last, t+TX); del pend[i]
        else:
            grp = [i]+clash
            if r.random() < CAPTURE_P:
                w = grp[r.integers(len(grp))]
                done += 1; last = max(last, pend[w]["t"]+TX); grp.remove(w); del pend[w]
            for j in grp:
                pend[j]["k"] += 1
                if pend[j]["k"] > max_retry: lost += 1; del pend[j]
                else: pend[j]["t"] = t+TX+r.uniform(0, SLOT*2**min(pend[j]["k"],9))
    return done, lost, last

print("ONE CHANNEL, 134 wardens, each sending a 6-shelter batch (0.89 s)")
print("Pure airtime needed: 134 x 0.89 = 119 s\n")
print("A) FREE-FOR-ALL (everyone transmits when they choose)")
print(f"   {'told to report within':>22}{'delivered':>11}{'gave up':>9}{'finished':>10}")
for w in (60, 300, 600, 1800):
    d = np.array([contention(134, w, 1000+s) for s in range(10)])
    print(f"   {w:>19} s{d[:,0].mean():>11.0f}{d[:,1].mean():>9.1f}{d[:,2].mean():>9.0f} s")

print("\nB) ASSIGNED SLOTS (centre polls, or each warden has a fixed minute)")
print("   no collisions at all, so it is pure arithmetic:")
for guard in (0.3, 1.0):
    slot = TX + guard
    print(f"   {slot:.2f} s slots -> all 134 wardens in {134*slot:.0f} s "
          f"({134*slot/60:.1f} min), 803 shelters covered")
print("\n   Same slots, run continuously: one full national refresh every "
      f"{134*(TX+1.0)/60:.1f} min")
