import { validationFailed } from "@culture-shock/domain";
import { analyzeRuleSet, type Rule, type RuleSet } from "@culture-shock/rules";
import type { ConfigField, PackManifest, WorkflowNode } from "./manifest.js";

export type PackConfigValue = string | number | boolean | readonly string[];
export type PackConfig = Readonly<Record<string, PackConfigValue>>;

export interface ConfigIssue {
  readonly key: string;
  readonly message: string;
}

export interface ResolvedConfig {
  readonly ok: boolean;
  readonly values: PackConfig;
  readonly issues: readonly ConfigIssue[];
}

function coerceField(field: ConfigField, raw: unknown): { value?: PackConfigValue; message?: string } {
  switch (field.type) {
    case "string": {
      if (typeof raw !== "string") return { message: "Expected a string" };
      if (raw.length > field.maxLength) return { message: `Exceeds ${field.maxLength} characters` };
      return { value: raw };
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return { message: "Expected a number" };
      if (raw < field.min || raw > field.max) {
        return { message: `Must be between ${field.min} and ${field.max}` };
      }
      return { value: raw };
    }
    case "boolean": {
      if (typeof raw !== "boolean") return { message: "Expected a boolean" };
      return { value: raw };
    }
    case "enum": {
      if (typeof raw !== "string") return { message: "Expected an option value" };
      if (!field.options.some((option) => option.value === raw)) return { message: "Unknown option" };
      return { value: raw };
    }
    case "stringList": {
      if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
        return { message: "Expected a list of strings" };
      }
      if (raw.length > field.maxItems) return { message: `At most ${field.maxItems} entries` };
      return { value: raw as readonly string[] };
    }
  }
}

/**
 * Applies designer overrides to the pack's declared configuration fields.
 * Unknown keys are rejected rather than silently stored.
 */
export function resolvePackConfig(manifest: PackManifest, overrides: Record<string, unknown>): ResolvedConfig {
  const issues: ConfigIssue[] = [];
  const values: Record<string, PackConfigValue> = {};
  const fields = new Map(manifest.configurationSchema.map((field) => [field.key, field]));

  for (const key of Object.keys(overrides)) {
    if (!fields.has(key)) issues.push({ key, message: "Unknown configuration field" });
  }

  for (const field of manifest.configurationSchema) {
    const provided = Object.prototype.hasOwnProperty.call(overrides, field.key)
      ? overrides[field.key]
      : (manifest.defaults[field.key] ?? field.default);

    if (provided === undefined || provided === null) {
      if (field.required) issues.push({ key: field.key, message: "Required value is missing" });
      continue;
    }

    const coerced = coerceField(field, provided);
    if (coerced.message) issues.push({ key: field.key, message: coerced.message });
    else if (coerced.value !== undefined) values[field.key] = coerced.value;
  }

  return { ok: issues.length === 0, values, issues };
}

/**
 * Merges pack rules with experience-level overrides. Overrides may only replace
 * a rule by id; they can never introduce a higher authority than the pack
 * declared, so an experience cannot weaken installation or privacy rules.
 */
export function effectiveRuleSet(manifest: PackManifest, overrides: readonly Rule[] = []): RuleSet {
  const merged = new Map<string, Rule>();
  for (const rule of [...manifest.eligibility, ...manifest.rules]) merged.set(rule.id, rule);

  for (const override of overrides) {
    const base = merged.get(override.id);
    if (base && base.category !== override.category) {
      throw validationFailed(`Override for rule "${override.id}" may not change its category`);
    }
    if (!base && (override.category === "installation_safety" || override.category === "privacy" || override.category === "consent")) {
      throw validationFailed(`Experience overrides may not introduce ${override.category} rules`);
    }
    merged.set(override.id, override);
  }

  const result = [...merged.values()];
  const analysis = analyzeRuleSet(result);
  if (!analysis.ok) {
    throw validationFailed("Effective rule set is invalid", {
      issues: analysis.issues.filter((issue) => issue.severity === "error"),
    });
  }
  return result;
}

export interface WorkflowPlanStep {
  readonly key: string;
  readonly action: string;
  readonly humanGate: boolean;
  readonly maxRetries: number;
  readonly timeoutMinutes: number;
  readonly templateKey: string | null;
  readonly dependsOn: readonly string[];
}

/**
 * Deterministic topological plan for the workflow DAG. Ties break on node key
 * so a given manifest always produces the same execution order.
 */
export function planWorkflow(manifest: PackManifest): WorkflowPlanStep[] {
  const nodes = new Map<string, WorkflowNode>(manifest.workflow.nodes.map((node) => [node.key, node]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of nodes.values()) {
    indegree.set(node.key, indegree.get(node.key) ?? 0);
    for (const next of node.next) {
      if (!nodes.has(next)) continue;
      indegree.set(next, (indegree.get(next) ?? 0) + 1);
      dependents.set(next, [...(dependents.get(next) ?? []), node.key]);
    }
  }

  const ready = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodeKey]) => nodeKey)
    .sort();
  const ordered: WorkflowPlanStep[] = [];

  while (ready.length > 0) {
    const current = ready.shift() as string;
    const node = nodes.get(current);
    if (!node) continue;
    ordered.push({
      key: node.key,
      action: node.action,
      humanGate: node.humanGate,
      maxRetries: node.maxRetries,
      timeoutMinutes: node.timeoutMinutes,
      templateKey: node.templateKey ?? null,
      dependsOn: (dependents.get(node.key) ?? []).slice().sort(),
    });
    for (const next of [...node.next].sort()) {
      if (!nodes.has(next)) continue;
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }

  if (ordered.length !== nodes.size) {
    throw validationFailed("Workflow contains a cycle and cannot be planned");
  }
  return ordered;
}
