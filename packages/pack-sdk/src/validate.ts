import { analyzeRuleSet, type RuleIssue } from "@culture-shock/rules";
import {
  ACTION_REQUIRED_CAPABILITIES,
  isCapabilityKey,
  type CapabilityKey,
  type WorkflowAction,
} from "./capabilities.js";
import { packManifestSchema, type PackManifest } from "./manifest.js";
import { unknownVariables } from "./templates.js";

export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly manifest: PackManifest | null;
  readonly issues: readonly ValidationIssue[];
}

export interface ValidationPolicy {
  /** Capabilities this installation's core version implements. */
  readonly supportedCapabilities: readonly CapabilityKey[];
  /** Locales the installation serves; a manifest must cover the default. */
  readonly defaultLocale: string;
  /** Data fields the installation permits a pack to require. */
  readonly permittedDataRequirements: readonly string[];
  readonly allowAiAssistants: boolean;
  readonly minimumCohortSize: number;
}

const error = (code: string, message: string, path: string): ValidationIssue => ({
  severity: "error",
  code,
  message,
  path,
});

const warning = (code: string, message: string, path: string): ValidationIssue => ({
  severity: "warning",
  code,
  message,
  path,
});

/**
 * Patterns that indicate an attempt to turn an inert prompt template into an
 * instruction that overrides policy. Detection is conservative and advisory for
 * imported packs, but blocking for AI-generated drafts.
 */
const INJECTION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i, "override_instructions"],
  [/\b(system|developer)\s*(prompt|message|role)\b/i, "role_escalation"],
  [/\byou\s+are\s+now\b/i, "role_escalation"],
  [/\bdisregard\b[^.]{0,40}\b(policy|rules|guardrails)\b/i, "policy_bypass"],
  [/https?:\/\//i, "embedded_url"],
  [/\b(select|insert|update|delete|drop)\s+.*\b(from|into|table)\b/i, "sql_like"],
  [/<\s*script/i, "script_tag"],
  [/\{\{\s*[^}]*\(/, "expression_like"],
];

export function scanForInjection(text: string): string[] {
  const findings = new Set<string>();
  for (const [pattern, code] of INJECTION_PATTERNS) {
    if (pattern.test(text)) findings.add(code);
  }
  return [...findings];
}

function validateWorkflow(manifest: PackManifest, issues: ValidationIssue[]): void {
  const nodes = new Map(manifest.workflow.nodes.map((node) => [node.key, node]));

  if (nodes.size !== manifest.workflow.nodes.length) {
    issues.push(error("duplicate_workflow_node", "Workflow node keys must be unique", "workflow.nodes"));
  }
  if (!nodes.has(manifest.workflow.entry)) {
    issues.push(
      error("unknown_entry_node", `Entry node "${manifest.workflow.entry}" is not defined`, "workflow.entry"),
    );
    return;
  }

  for (const node of manifest.workflow.nodes) {
    for (const next of node.next) {
      if (!nodes.has(next)) {
        issues.push(
          error("unknown_workflow_edge", `Node "${node.key}" references unknown node "${next}"`, `workflow.nodes.${node.key}.next`),
        );
      }
    }
    if (node.action === "send_notification") {
      if (!node.templateKey) {
        issues.push(
          error("missing_template", `Node "${node.key}" must name a communication template`, `workflow.nodes.${node.key}.templateKey`),
        );
      } else if (!manifest.communications.some((template) => template.key === node.templateKey)) {
        issues.push(
          error("unknown_template", `Node "${node.key}" references undefined template "${node.templateKey}"`, `workflow.nodes.${node.key}.templateKey`),
        );
      }
    }
    const required = ACTION_REQUIRED_CAPABILITIES[node.action as WorkflowAction];
    if (required && !required.some((capability) => manifest.requiredCapabilities.includes(capability))) {
      issues.push(
        error(
          "action_capability_missing",
          `Action "${node.action}" requires one of: ${required.join(", ")}`,
          `workflow.nodes.${node.key}.action`,
        ),
      );
    }
  }

  // Depth-first cycle detection; a workflow must be a DAG so execution terminates.
  const state = new Map<string, "visiting" | "done">();
  const visit = (nodeKey: string, trail: string[]): void => {
    const current = state.get(nodeKey);
    if (current === "done") return;
    if (current === "visiting") {
      issues.push(
        error("workflow_cycle", `Workflow contains a cycle: ${[...trail, nodeKey].join(" -> ")}`, "workflow.nodes"),
      );
      return;
    }
    state.set(nodeKey, "visiting");
    for (const next of nodes.get(nodeKey)?.next ?? []) {
      if (nodes.has(next)) visit(next, [...trail, nodeKey]);
    }
    state.set(nodeKey, "done");
  };
  visit(manifest.workflow.entry, []);

  const reachable = new Set(state.keys());
  for (const node of manifest.workflow.nodes) {
    if (!reachable.has(node.key)) {
      issues.push(
        warning("unreachable_workflow_node", `Node "${node.key}" is unreachable from the entry node`, `workflow.nodes.${node.key}`),
      );
    }
  }
  if (!manifest.workflow.nodes.some((node) => node.action === "finish")) {
    issues.push(warning("no_terminal_node", "Workflow has no finish action", "workflow.nodes"));
  }
}

function validateTemplates(manifest: PackManifest, policy: ValidationPolicy, issues: ValidationIssue[]): void {
  for (const template of manifest.communications) {
    const surfaces: Array<[string, Record<string, string>]> = [
      ["subject", template.subject],
      ["body", template.body],
      ["plainTextBody", template.plainTextBody],
    ];
    for (const [field, localized] of surfaces) {
      if (!localized[policy.defaultLocale]) {
        issues.push(
          error(
            "missing_default_locale",
            `Template "${template.key}" is missing locale ${policy.defaultLocale}`,
            `communications.${template.key}.${field}`,
          ),
        );
      }
      for (const [locale, text] of Object.entries(localized)) {
        const unknown = unknownVariables(text);
        if (unknown.length > 0) {
          issues.push(
            error(
              "unknown_template_variable",
              `Template "${template.key}" uses unsupported variables: ${unknown.join(", ")}`,
              `communications.${template.key}.${field}.${locale}`,
            ),
          );
        }
        const injection = scanForInjection(text);
        if (injection.length > 0) {
          issues.push(
            error(
              "unsafe_template_content",
              `Template "${template.key}" contains unsafe content: ${injection.join(", ")}`,
              `communications.${template.key}.${field}.${locale}`,
            ),
          );
        }
      }
    }
  }
}

function validateAi(manifest: PackManifest, policy: ValidationPolicy, issues: ValidationIssue[]): void {
  if (manifest.aiAssistants.length === 0) return;
  if (!manifest.requiredCapabilities.includes("ai.assistant")) {
    issues.push(
      error("ai_capability_missing", "AI assistants require the ai.assistant capability", "aiAssistants"),
    );
  }
  if (!policy.allowAiAssistants) {
    issues.push(
      warning(
        "ai_disabled_by_policy",
        "AI assistants are declared but disabled by installation policy; manual fallbacks will be used",
        "aiAssistants",
      ),
    );
  }
  for (const assistant of manifest.aiAssistants) {
    const findings = scanForInjection(assistant.promptTemplate);
    if (findings.length > 0) {
      issues.push(
        error(
          "prompt_injection_detected",
          `Assistant "${assistant.key}" prompt contains: ${findings.join(", ")}`,
          `aiAssistants.${assistant.key}.promptTemplate`,
        ),
      );
    }
    const unknown = unknownVariables(assistant.promptTemplate);
    if (unknown.length > 0) {
      issues.push(
        error(
          "unknown_template_variable",
          `Assistant "${assistant.key}" uses unsupported variables: ${unknown.join(", ")}`,
          `aiAssistants.${assistant.key}.promptTemplate`,
        ),
      );
    }
  }
}

function validatePrivacy(manifest: PackManifest, policy: ValidationPolicy, issues: ValidationIssue[]): void {
  for (const requirement of manifest.dataRequirements) {
    if (!policy.permittedDataRequirements.includes(requirement)) {
      issues.push(
        error(
          "forbidden_data_requirement",
          `Installation policy does not permit collecting "${requirement}"`,
          "dataRequirements",
        ),
      );
    }
  }
  if (manifest.insights.minimumCohortSize < policy.minimumCohortSize) {
    issues.push(
      error(
        "cohort_threshold_too_low",
        `Minimum cohort size must be at least ${policy.minimumCohortSize}`,
        "insights.minimumCohortSize",
      ),
    );
  }
  if (manifest.reveal.enabled && manifest.reveal.mode === "never_reveal") {
    issues.push(
      error("reveal_conflicts_with_privacy", "Reveal cannot be enabled in never_reveal mode", "reveal"),
    );
  }
  if (!manifest.reveal.enabled && manifest.workflow.nodes.some((node) => node.action === "reveal")) {
    issues.push(
      error("reveal_not_enabled", "Workflow schedules a reveal but reveal is disabled", "workflow.nodes"),
    );
  }
}

function ruleIssueToValidationIssue(issue: RuleIssue, path: string): ValidationIssue {
  return {
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    path: issue.ruleIds.length > 0 ? `${path}.${issue.ruleIds[0]}` : path,
  };
}

/**
 * Full manifest validation. Fails closed: any unknown field, unsupported
 * capability, cyclic workflow, unsafe template, or forbidden data requirement
 * blocks import and publication.
 */
export function validateManifest(input: unknown, policy: ValidationPolicy): ValidationResult {
  const parsed = packManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      manifest: null,
      issues: parsed.error.issues.map((issue) =>
        error("schema_invalid", issue.message, issue.path.join(".")),
      ),
    };
  }

  const manifest = parsed.data;
  const issues: ValidationIssue[] = [];

  for (const capability of manifest.requiredCapabilities) {
    if (!isCapabilityKey(capability)) {
      issues.push(error("unknown_capability", `Unknown capability "${capability}"`, "requiredCapabilities"));
      continue;
    }
    if (!policy.supportedCapabilities.includes(capability)) {
      issues.push(
        error(
          "unsupported_capability",
          `Capability "${capability}" is not implemented by this installation; a reviewed core release is required`,
          "requiredCapabilities",
        ),
      );
    }
  }

  const eligibility = analyzeRuleSet(manifest.eligibility);
  issues.push(...eligibility.issues.map((issue) => ruleIssueToValidationIssue(issue, "eligibility")));
  const rules = analyzeRuleSet(manifest.rules);
  issues.push(...rules.issues.map((issue) => ruleIssueToValidationIssue(issue, "rules")));

  validateWorkflow(manifest, issues);
  validateTemplates(manifest, policy, issues);
  validateAi(manifest, policy, issues);
  validatePrivacy(manifest, policy, issues);

  const configKeys = new Set(manifest.configurationSchema.map((field) => field.key));
  for (const defaultKey of Object.keys(manifest.defaults)) {
    if (!configKeys.has(defaultKey)) {
      issues.push(
        error("unknown_default", `Default "${defaultKey}" has no matching configuration field`, "defaults"),
      );
    }
  }

  return { ok: !issues.some((issue) => issue.severity === "error"), manifest, issues };
}
