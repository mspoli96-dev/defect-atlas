import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DATASET_VERSION, SAMPLES, getReferences } from "../src/lib/dataset";
import type { InspectionRequest, InspectionResult, PolicyId, RecordedRun } from "../src/lib/contracts";
import { candidateImage } from "../src/lib/server/images";
import { buildDecisionRequest, inspectImage } from "../src/lib/server/provider";
import { MODEL } from "../src/lib/server/config";

async function main() {
const destination = resolve("src/data/recorded-runs.json");
const pilot = process.argv.includes("--pilot");
const manifest = JSON.parse(await readFile("src/data/dataset-manifest.json", "utf8"));
if (!pilot && manifest.preparationStatus !== "complete") throw new Error("The dataset must be complete before recording the full benchmark.");
if (!process.env.OPENAI_API_KEY) throw new Error("A server-side credential is required.");
const policies: PolicyId[] = ["appearance-v1", "reference-v2"];
const runs: RecordedRun[] = JSON.parse(await readFile(destination, "utf8"));
const candidates = pilot
  ? [SAMPLES.find(sample => sample.category === "candle" && sample.split === "calibration" && sample.truth === "normal")!, SAMPLES.find(sample => sample.category === "candle" && sample.split === "calibration" && sample.truth === "anomaly")!]
  : SAMPLES.filter(sample => sample.split !== "reference");
if (candidates.some(sample => !sample)) throw new Error("Pilot samples are unavailable.");
let calls = 0;
for (const policyId of policies) {
  let run = runs.find(item => item.policyId === policyId && item.datasetVersion === DATASET_VERSION);
  const fingerprint = createHash("sha256").update(JSON.stringify(buildDecisionRequest("candle", policyId, "TARGET_BYTES", policyId === "reference-v2" ? ["REFERENCE_1_BYTES", "REFERENCE_2_BYTES"] : []))).digest("hex");
  if (!run) {
    run = { id: `${DATASET_VERSION}-${policyId}-${Date.now()}`, datasetVersion: DATASET_VERSION, policyId, model: MODEL, capturedAt: new Date().toISOString(), results: [], notes: ["Actual Decisions API outputs recorded for this selected public VisA subset; not synthetic predictions.", "Reference, calibration and holdout source images are disjoint. Policy text was fixed before the holdout run.", "Model estimates are not calibrated guarantees. Holdout means held out from this application's references and calibration, not verified absent from model training.", `Policy fingerprint: ${fingerprint}`, `Normal references per category: candle=${getReferences("candle").slice(0,2).map(sample=>sample.id).join(",")}; pcb1=${getReferences("pcb1").slice(0,2).map(sample=>sample.id).join(",")}`] };
    runs.push(run);
  } else if (!run.notes.includes(`Policy fingerprint: ${fingerprint}`)) {
    throw new Error("The policy changed after recording started. Preserve the prior run and create a separately versioned policy.");
  }
  const pcbFingerprint = createHash("sha256").update(JSON.stringify(buildDecisionRequest("pcb1", policyId, "TARGET_BYTES", policyId === "reference-v2" ? ["REFERENCE_1_BYTES", "REFERENCE_2_BYTES"] : []))).digest("hex");
  const previousPcbFingerprint = run.notes.find(note => note.startsWith("PCB policy fingerprint:"));
  if (previousPcbFingerprint && previousPcbFingerprint !== `PCB policy fingerprint: ${pcbFingerprint}`) throw new Error("The circuit-board policy changed after recording started.");
  if (!previousPcbFingerprint) {
    if (run.results.some(result => result.category === "pcb1")) throw new Error("Existing circuit-board results need provenance review.");
    run.notes.push(`PCB policy fingerprint: ${pcbFingerprint}`);
  }
  run.notes = run.notes.filter(note => !note.startsWith("Normal references per category:"));
  run.notes.push(`Normal references per category: candle=${getReferences("candle").slice(0,2).map(sample=>sample.id).join(",")}; pcb1=${getReferences("pcb1").slice(0,2).map(sample=>sample.id).join(",")}`);
  for (const sample of candidates) {
    if (run.results.some(result => result.sampleId === sample.id)) continue;
    const recordedTokens = runs.flatMap(item=>item.results).reduce((sum,result)=>sum+result.inputTokens,0);
    if (recordedTokens > 4_500_000 || calls >= 160) throw new Error("Recording allowance reached. Review usage before continuing.");
    const request: InspectionRequest = { sampleId: sample.id, category: sample.category, policyId, revision: 0, consent: true };
    const at = Date.now();
    let result: InspectionResult;
    try {
      const image = await candidateImage(request);
      calls += 1;
      result = await inspectImage(request, image, undefined, "recorded");
    } catch {
      result = { id: randomUUID(), sampleId: sample.id, category: sample.category, policyId, status: "failed", anomalyProbability: null, usableProbability: null, categoryChoice: null, categoryConfidence: null, severityScore: null, severityProbabilities: [], refusalReason: "This recording attempt did not complete. No automatic retry was made.", model: MODEL, latencyMs: Date.now()-at, inputTokens: 0, capturedAt: new Date().toISOString(), source: "recorded" };
    }
    run.results.push(result);
    await writeFile(destination, JSON.stringify(runs,null,2)+"\n");
    console.log(JSON.stringify({ policyId, sampleId: sample.id, status: result.status, anomalyProbability: result.anomalyProbability, usability: result.usableProbability, category: result.categoryChoice, categoryConfidence: result.categoryConfidence, inputTokens: result.inputTokens, recorded: run.results.length }));
    if (result.status === "failed") throw new Error("A recording attempt failed. State was preserved; inspect before another paid attempt.");
  }
}
console.log(JSON.stringify({ complete: !pilot, callsThisRun: calls, results: runs.map(run=>({policyId:run.policyId,count:run.results.length})), totalInputTokens:runs.flatMap(run=>run.results).reduce((sum,result)=>sum+result.inputTokens,0) }));
}

main().catch(() => { console.error("Recording stopped. Saved outputs remain available; no provider details were logged."); process.exitCode = 1; });
