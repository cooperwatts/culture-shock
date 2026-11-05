import { conflict } from "@culture-shock/domain";
import { BUILT_IN_STRATEGIES } from "./strategies.js";
import type { MatchingStrategy } from "./types.js";

/**
 * Strategy registry. Data-only packs select a registered key; a genuinely new
 * algorithm requires a reviewed core release, not a manifest field.
 */
export class MatchingStrategyRegistry {
  readonly #strategies = new Map<string, MatchingStrategy>();

  constructor(strategies: readonly MatchingStrategy[] = BUILT_IN_STRATEGIES) {
    for (const strategy of strategies) this.register(strategy);
  }

  register(strategy: MatchingStrategy): void {
    const key = `${strategy.key}@${strategy.version}`;
    if (this.#strategies.has(key)) throw conflict(`Strategy ${key} is already registered`);
    this.#strategies.set(key, strategy);
  }

  /** Resolves an exact version, or the highest registered version for a key. */
  resolve(key: string, version?: string): MatchingStrategy {
    if (version) {
      const exact = this.#strategies.get(`${key}@${version}`);
      if (!exact) throw conflict(`Strategy ${key}@${version} is not registered`);
      return exact;
    }
    const candidates = [...this.#strategies.values()]
      .filter((strategy) => strategy.key === key)
      .sort((a, b) => b.version.localeCompare(a.version, "en", { numeric: true }));
    const latest = candidates[0];
    if (!latest) throw conflict(`Strategy ${key} is not registered`);
    return latest;
  }

  list(): MatchingStrategy[] {
    return [...this.#strategies.values()];
  }
}

export const defaultStrategyRegistry = new MatchingStrategyRegistry();
