import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectionRequest, InspectionResult } from "../src/lib/contracts";
import { budgetLimits, publicConfig } from "../src/lib/server/config";
import { inspectionResponse, configResponse } from "../src/lib/server/handlers";
import { newVisitor, PublicError, readBoundedJson, visitorFromRequest } from "../src/lib/server/security";
import { createInspectionStore } from "../src/lib/server/store";

const origin="https://defect-atlas.example";
const input: InspectionRequest={sampleId:"opaque",category:"candle",policyId:"appearance-v1",revision:2,consent:true};
const result: InspectionResult={id:"r1",sampleId:"opaque",category:"candle",policyId:"appearance-v1",status:"evaluated",anomalyProbability:0.8,usableProbability:0.9,categoryChoice:"candle",categoryConfidence:1,severityScore:1,severityProbabilities:[0,1,0,0],refusalReason:null,model:"gpt-6-luna",latencyMs:100,inputTokens:1000,capturedAt:"2026-10-09T12:00:00Z",source:"live"};
beforeEach(()=>{
  for(const[name,value]of Object.entries({OPENAI_API_KEY:"test-only-key",SESSION_SECRET:"test-only-secret".repeat(4),KV_REST_API_URL:"https://redis.example",KV_REST_API_TOKEN:"test-only-token",UPSTASH_REDIS_REST_URL:"",UPSTASH_REDIS_REST_TOKEN:"",APP_ORIGIN:origin,DEFECT_ATLAS_LIVE_ENABLED:"true",DEFECT_ATLAS_MONTHLY_BUDGET_USD:"2",DEFECT_ATLAS_COST_RESERVATION_CONFIRMED:"true",OPENAI_PROJECT_HARD_LIMIT_CONFIRMED:"true",VERCEL_BOTID_ENABLED:"true",VERCEL_RATE_LIMIT_CONFIRMED:"true",VERCEL:"1"}))vi.stubEnv(name,value);
});
afterEach(()=>vi.unstubAllEnvs());
function request(body:unknown=input,headers:Record<string,string>={}){
 return new Request(`${origin}/api/inspect`,{method:"POST",headers:{origin,cookie:newVisitor(new Request(origin)).cookie,"content-type":"application/json",...headers},body:typeof body==="string"?body:JSON.stringify(body)});
}
function services(){
 const store={reserve:vi.fn().mockResolvedValue(undefined),release:vi.fn().mockResolvedValue(undefined)};
 return{store,dependencies:{store:()=>store,prepareImage:vi.fn().mockResolvedValue("data:image/jpeg;base64,NORMALIZED"),inspect:vi.fn().mockResolvedValue(result),verifyBrowser:vi.fn().mockResolvedValue(true)}};
}
describe("inspection route admission",()=>{
 it("issues a private signed cookie and no-store config only for enabled live mode",async()=>{
  const response=configResponse(new Request(origin));expect(response.headers.get("set-cookie")).toContain("defect-atlas_visitor=");expect(response.headers.get("cache-control")).toBe("no-store");expect((await response.json()).liveEnabled).toBe(true);
  vi.stubEnv("DEFECT_ATLAS_LIVE_ENABLED","false");const offline=configResponse(new Request(origin));expect(offline.headers.get("set-cookie")).toBeNull();expect((await offline.json()).liveEnabled).toBe(false);
 });
 it("requires every paid endpoint prerequisite",()=>{
  for(const flag of["DEFECT_ATLAS_LIVE_ENABLED","DEFECT_ATLAS_COST_RESERVATION_CONFIRMED","OPENAI_PROJECT_HARD_LIMIT_CONFIRMED","VERCEL_BOTID_ENABLED","VERCEL_RATE_LIMIT_CONFIRMED"]){vi.stubEnv(flag,"false");expect(publicConfig().liveEnabled).toBe(false);vi.stubEnv(flag,"true");}
  vi.stubEnv("KV_REST_API_TOKEN","");expect(publicConfig().liveEnabled).toBe(false);
 });
 it("enforces a fixed reservation and cannot raise the application allowance",()=>{
  expect(budgetLimits()).toEqual({monthlyMicroUsd:2_000_000,reserveMicroUsd:10_000});
  for(const value of["20","-1","0","1e2","0.009","NaN"]){vi.stubEnv("DEFECT_ATLAS_MONTHLY_BUDGET_USD",value);expect(publicConfig().liveEnabled).toBe(false);}
 });
 it("rejects invalid origins and cookies before image decoding or paid admission",async()=>{
  for(const headers of[{origin:"https://attacker.example"},{origin:""},{cookie:""},{cookie:"defect-atlas_visitor=bad"}] as Record<string,string>[]){
   const{dependencies,store}=services();expect((await inspectionResponse(request(input,headers),dependencies)).status).toBe(403);expect(dependencies.prepareImage).not.toHaveBeenCalled();expect(store.reserve).not.toHaveBeenCalled();
  }
 });
 it.each([{consent:false},{category:"person"},{policyId:"custom"},{revision:-1},{truth:"normal"},{imageDataUrl:"data:image/jpeg;base64,abcd"}])("rejects extra or invalid request fields %#",async patch=>{
  const{dependencies,store}=services();expect((await inspectionResponse(request({...input,...patch}),dependencies)).status).toBe(400);expect(store.reserve).not.toHaveBeenCalled();expect(dependencies.inspect).not.toHaveBeenCalled();
 });
 it("rejects missing browser proof and verifier failures before processing images",async()=>{
  const{dependencies,store}=services();dependencies.verifyBrowser.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("private-verifier"));
  expect((await inspectionResponse(request(),dependencies)).status).toBe(403);const response=await inspectionResponse(request(),dependencies);expect(response.status).toBe(503);expect(await response.text()).not.toContain("private-verifier");expect(dependencies.prepareImage).not.toHaveBeenCalled();expect(store.reserve).not.toHaveBeenCalled();
 });
 it("validates image bytes before reserving a paid attempt",async()=>{
  const{dependencies,store}=services();dependencies.prepareImage.mockRejectedValueOnce(new PublicError("Unsupported image.",400));expect((await inspectionResponse(request(),dependencies)).status).toBe(400);expect(store.reserve).not.toHaveBeenCalled();
 });
 it("calls the provider exactly once with normalized image, returning the same revision",async()=>{
  const{dependencies,store}=services();const response=await inspectionResponse(request(),dependencies);expect(response.status).toBe(200);expect(await response.json()).toEqual({result,revision:2});expect(dependencies.inspect).toHaveBeenCalledExactlyOnceWith(input,"data:image/jpeg;base64,NORMALIZED");expect(store.release).toHaveBeenCalledWith(...store.reserve.mock.calls[0]);
 });
 it("retains an uncertain lease and does not retry after provider failure",async()=>{
  const{dependencies,store}=services();dependencies.inspect.mockRejectedValueOnce(new PublicError("Could not finish.",502));expect((await inspectionResponse(request(),dependencies)).status).toBe(502);expect(dependencies.inspect).toHaveBeenCalledOnce();expect(store.release).not.toHaveBeenCalled();
 });
 it("fails closed when admission is unavailable",async()=>{
  const{dependencies,store}=services();store.reserve.mockRejectedValueOnce(new Error("private-redis-value"));const response=await inspectionResponse(request(),dependencies);expect(response.status).toBe(503);expect(await response.text()).not.toContain("private-redis");expect(dependencies.inspect).not.toHaveBeenCalled();
 });
 it("bounds actual UTF-8 request bytes, types and malformed JSON",async()=>{
  await expect(readBoundedJson(request({data:"é".repeat(4096)}))).rejects.toMatchObject({status:413});
  await expect(readBoundedJson(request("{}",{"content-type":"text/plain"}))).rejects.toMatchObject({status:415});
  await expect(readBoundedJson(request("{bad"))).rejects.toMatchObject({status:400});
 });
 it("rejects tampered, future and expired visitor cookies",()=>{
  const now=Date.now();const visitor=newVisitor(new Request(origin),now);const signed=new Request(origin,{headers:{cookie:visitor.cookie}});
  expect(visitorFromRequest(signed,now)).toBe(visitor.id);expect(visitorFromRequest(signed,now-1)).toBeNull();expect(visitorFromRequest(signed,now+86_400_001)).toBeNull();expect(visitorFromRequest(new Request(origin,{headers:{cookie:visitor.cookie.replace(visitor.id,"00000000-0000-4000-8000-000000000000")}}),now)).toBeNull();
 });
 it("uses an independent atomic Redis namespace and fixed per-image reservation",async()=>{
  const execute=vi.fn().mockResolvedValue(1);const store=createInspectionStore({eval:execute},()=>Date.parse("2026-10-09T12:00:00Z"));await store.reserve("v","r");const[,keys,args]=execute.mock.calls[0];expect(keys.every((key:string)=>key.startsWith("defect-atlas:{admission}:"))).toBe(true);expect(args.slice(2)).toEqual([90,100,24,2,10_000,2_000_000]);await store.release("v","r");expect(execute.mock.calls[1][1]).toHaveLength(2);
 });
 it.each([-1,-2,-3,-4,0])("fails closed for Redis response %s",async code=>{const store=createInspectionStore({eval:vi.fn().mockResolvedValue(code)});await expect(store.reserve("v","r")).rejects.toBeInstanceOf(PublicError);});
});
