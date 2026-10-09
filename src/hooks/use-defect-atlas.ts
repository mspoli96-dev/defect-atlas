"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CategoryId, InspectionRequest, InspectionResponse, InspectionResult, LiveConfig, PolicyId, ReviewDecision, Thresholds } from "@/lib/contracts";
import { DEFAULT_THRESHOLDS } from "@/lib/policies";

type View = "inspect" | "calibrate" | "compare";
type Upload = { file: File; preview: string; result: InspectionResult | null };
type Progress = { completed: number; total: number; running: boolean };

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("This image could not be read."));
    reader.onerror = () => reject(new Error("This image could not be read."));
    reader.readAsDataURL(file);
  });
}

export function useDefectAtlas() {
  const [view, setView] = useState<View>("inspect");
  const [category, setCategory] = useState<CategoryId>("candle");
  const [policyId, setPolicyId] = useState<PolicyId>("reference-v2");
  const [source, setSourceState] = useState<"recorded" | "live">("recorded");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>({ ...DEFAULT_THRESHOLDS });
  const [frozenThresholds, setFrozenThresholds] = useState<Thresholds | null>(null);
  const [holdoutViewed, setHoldoutViewed] = useState(false);
  const [holdoutEvaluations, setHoldoutEvaluations] = useState(0);
  const [liveConfig, setLiveConfig] = useState<LiveConfig | null>(null);
  const [consent, setConsent] = useState(false);
  const [liveResults, setLiveResults] = useState<InspectionResult[]>([]);
  const [resultHistory, setResultHistory] = useState<InspectionResult[]>([]);
  const [reviews, setReviews] = useState<ReviewDecision[]>([]);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress>({ completed: 0, total: 0, running: false });
  const [notice, setNotice] = useState<string | null>(null);
  const revision = useRef(0);
  const consentRef = useRef(false);
  const activeController = useRef<AbortController | null>(null);
  const uploadUrl = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        setLiveConfig(await response.json() as LiveConfig);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLiveConfig({ liveEnabled: false, model: "gpt-6-luna", unavailableReason: "Live inspection is unavailable. You can still explore recorded model runs." });
      });
    return () => { controller.abort(); activeController.current?.abort(); if (uploadUrl.current) URL.revokeObjectURL(uploadUrl.current); };
  }, []);

  const cancel = useCallback((message = "Inspection stopped. Completed results are kept in this session.") => {
    revision.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setProgress((previous) => ({ ...previous, running: false }));
    setNotice(message);
  }, []);

  function changeConsent(value: boolean) {
    consentRef.current = value;
    if (!value) cancel("Consent withdrawn. No further images will be sent. A request already sent may still finish at the provider.");
    setConsent(value);
  }

  function changeCategory(value: CategoryId) {
    cancel("Product family changed. Any in-progress inspection was cancelled.");
    setCategory(value); setSelectedId(null); setBatchIds([]); setUpload(null);
    if (uploadUrl.current) { URL.revokeObjectURL(uploadUrl.current); uploadUrl.current = null; }
  }

  function changePolicy(value: PolicyId) {
    cancel("Inspection policy changed. Send a new request to use this policy.");
    setPolicyId(value);
    setUpload((previous) => previous ? { ...previous, result: null } : null);
  }

  function changeSource(value: "recorded" | "live") {
    cancel(""); setNotice(null); setSourceState(value);
  }

  function updateThresholds(update: Partial<Thresholds>) {
    setThresholds((previous) => ({ ...previous, ...update }));
  }

  function freezeHoldout() {
    setFrozenThresholds({ ...thresholds }); setHoldoutViewed(true); setHoldoutEvaluations((count) => count + 1); setView("compare");
  }

  function selectImage(id: string) { setSelectedId(id); }

  function toggleBatch(id: string) {
    setBatchIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : previous.length < 8 ? [...previous, id] : previous);
  }

  function chooseUpload(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setNotice("Choose a JPEG, PNG or WebP photograph."); return; }
    if (file.size > 2 * 1024 * 1024) { setNotice("Choose an image smaller than 2 MB."); return; }
    cancel("");
    if (uploadUrl.current) URL.revokeObjectURL(uploadUrl.current);
    uploadUrl.current = URL.createObjectURL(file);
    setUpload({ file, preview: uploadUrl.current, result: null });
    setSelectedId("custom-upload"); setSourceState("live"); setNotice(null);
  }

  async function inspect(sampleIds: string[], useUpload = false) {
    if (!liveConfig?.liveEnabled || !consentRef.current || progress.running) return;
    const ids = useUpload ? ["custom-upload"] : [...new Set(sampleIds)].slice(0, 8);
    if (!ids.length || (useUpload && !upload)) return;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const requestRevision = ++revision.current;
    setNotice(null); setProgress({ completed: 0, total: ids.length, running: true });
    let completed = 0;
    try {
      const uploadData = useUpload && upload ? await fileDataUrl(upload.file) : undefined;
      for (const sampleId of ids) {
        if (!consentRef.current || controller.signal.aborted || revision.current !== requestRevision) break;
        const payload: InspectionRequest = {
          category, policyId, revision: requestRevision, consent: true,
          ...(useUpload ? { imageDataUrl: uploadData } : { sampleId }),
        };
        const response = await fetch("/api/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
        const body = await response.json() as InspectionResponse & { error?: string };
        if (!consentRef.current || controller.signal.aborted || revision.current !== requestRevision) break;
        if (!response.ok) throw new Error(body.error || "This inspection could not be completed. Please try again later.");
        if (body.revision !== requestRevision || !body.result) throw new Error("The response no longer matches this inspection. Please start a new request.");
        if (useUpload) setUpload((previous) => previous ? { ...previous, result: body.result } : null);
        setResultHistory((previous) => previous.some((item) => item.id === body.result.id) ? previous : [...previous, { ...body.result, severityProbabilities: [...body.result.severityProbabilities] }]);
        setLiveResults((previous) => [...previous.filter((item) => !(item.sampleId === body.result.sampleId && item.policyId === body.result.policyId)), body.result]);
        completed += 1;
        setProgress({ completed, total: ids.length, running: true });
      }
      if (revision.current === requestRevision) setNotice(`${completed} ${completed === 1 ? "photo inspected" : "photos inspected"} with the live Decisions API. Results stay in this browser session.`);
    } catch (error: unknown) {
      if (revision.current !== requestRevision || (error instanceof Error && error.name === "AbortError")) return;
      setNotice(error instanceof Error ? error.message : "Inspection could not be completed.");
    } finally {
      if (revision.current === requestRevision) { activeController.current = null; setProgress({ completed, total: ids.length, running: false }); }
    }
  }

  function review(resultId: string, label: ReviewDecision["label"]) {
    setReviews((previous) => [...previous.filter((item) => item.resultId !== resultId), { resultId, label, reviewedAt: new Date().toISOString() }]);
    setNotice("Human review saved for this session. The benchmark label and model are unchanged.");
  }

  return {
    view, setView, category, changeCategory, policyId, changePolicy, source, changeSource,
    selectedId, selectImage, thresholds, updateThresholds, frozenThresholds, holdoutViewed, holdoutEvaluations, freezeHoldout,
    liveConfig, consent, changeConsent, liveResults, resultHistory, reviews, review, upload, chooseUpload,
    batchIds, toggleBatch, progress, cancel, inspect, notice, setNotice,
  };
}
