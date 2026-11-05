import appreciationWeek from "../../../../packs/appreciation-week/manifest.json";
import coffeeRoulette from "../../../../packs/coffee-roulette/manifest.json";
import crossTeamConnector from "../../../../packs/cross-team-connector/manifest.json";
import newHireBuddy from "../../../../packs/new-hire-buddy/manifest.json";
import secretSanta from "../../../../packs/secret-santa/manifest.json";

/**
 * First-party manifests are bundled as data, not code. They are seeded through
 * the same validation and publication path as any imported manifest.
 */
export const BUILT_IN_MANIFESTS: readonly unknown[] = [
  secretSanta,
  appreciationWeek,
  coffeeRoulette,
  newHireBuddy,
  crossTeamConnector,
];
