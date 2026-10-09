import manifest from "../data/dataset-manifest.json";
import type { CategoryId, Sample, SampleSplit } from "./contracts";

export const DATASET_VERSION = manifest.version;
export const SAMPLES: Sample[] = manifest.samples as Sample[];

export const CATEGORIES: { id: CategoryId; name: string; description: string }[] = [
  { id: "candle", name: "Candles", description: "Candle surfaces, wicks and packaging photographed from above." },
  { id: "pcb1", name: "Circuit boards", description: "PCB1 printed circuit boards with visible components and connections." },
];

export function getSample(id: string): Sample | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}

export function getSamples(category: CategoryId, split: SampleSplit): Sample[] {
  return SAMPLES.filter((sample) => sample.category === category && sample.split === split);
}

export function getReferences(category: CategoryId): Sample[] {
  return getSamples(category, "reference");
}
