/**
 * Acquisition scope for multi-part asset loads. OWNER: Technical Artist G (TA-07).
 *
 * A load such as loadVat acquires several ref-counted cache entries in parallel (one GLB + one VAT payload per
 * LOD, the bound PBR materials, ...). With a bare Promise.all, the first rejection runs the caller's cleanup while
 * siblings are still in flight; a sibling that resolves afterwards would push its key into an array that has
 * already been released, so its refs never return to 0 and its GPU resources live until AssetManager.dispose().
 *
 * AcquireScope tracks every acquisition from the moment it STARTS: `track(promise, release)` records the release
 * as soon as the acquisition resolves - or runs it immediately if the scope was already released (a late sibling
 * of a failed load). `release()` is idempotent and frees everything acquired so far, in acquisition order.
 *
 *   const scope = new AcquireScope();
 *   try {
 *     const [a, b] = await Promise.all([scope.track(acquire(x), () => releaseFrom(x)), scope.track(...)]);
 *     return { ..., release: () => scope.release() };
 *   } catch (err) {
 *     scope.release();           // frees what resolved; whatever resolves later is freed on arrival
 *     return null;
 *   }
 */
export class AcquireScope {
  private readonly releases: (() => void)[] = [];
  private released = false;
  private pending = 0;

  /** True once release() ran (late acquisitions are freed on arrival). */
  get isReleased(): boolean {
    return this.released;
  }

  /** Acquisitions started but not yet settled (tests / diagnostics). */
  get inFlight(): number {
    return this.pending;
  }

  /** Acquisitions currently held by the scope. */
  get held(): number {
    return this.releases.length;
  }

  /**
   * Track an acquisition. `release(value)` runs exactly once: on release(), or right away when the acquisition
   * resolves after the scope was released. A rejected acquisition holds nothing (its cache entry already dropped
   * the ref) and the rejection propagates to the caller unchanged.
   */
  track<T>(acquisition: Promise<T>, release: (value: T) => void): Promise<T> {
    this.pending++;
    return acquisition.then(
      (v) => {
        this.pending--;
        let done = false;
        const once = (): void => {
          if (done) return;
          done = true;
          release(v);
        };
        if (this.released) once();
        else this.releases.push(once);
        return v;
      },
      (err: unknown) => {
        this.pending--;
        throw err;
      },
    );
  }

  /** Release everything acquired so far; later arrivals are released as they resolve. Idempotent. */
  release(): void {
    this.released = true;
    const rs = this.releases.splice(0);
    for (const r of rs) r();
  }
}
