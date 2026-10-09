import type { Policy, PolicyId, Thresholds } from "./contracts";

export const POLICIES: Policy[] = [
  {
    id: "appearance-v1",
    name: "Appearance only",
    version: "1.0.0",
    description: "Assess visible anomalies using the inspection instructions, without reference photographs.",
    usesReferences: false,
  },
  {
    id: "reference-v2",
    name: "Reference guided",
    version: "2.0.0",
    description: "Assess the same visible-anomaly criteria with separate normal reference photographs. This is an instruction policy, not a retrained model.",
    usesReferences: true,
  },
];

export const DEFAULT_THRESHOLDS: Thresholds = Object.freeze({
  clearMax: 0.2,
  flagMin: 0.8,
  usabilityMin: 0.7,
  categoryConfidenceMin: 0.75,
});

export function getPolicy(id: PolicyId | string): Policy {
  const policy = POLICIES.find((candidate) => candidate.id === id);
  if (!policy) throw new Error(`Unknown inspection policy: ${id}`);
  return policy;
}
