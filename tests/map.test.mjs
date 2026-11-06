import test from "node:test";
import assert from "node:assert/strict";
import {resolveMapPenalty} from "../scripts/rules.mjs";
const rule=(value,extra={})=>({selector:"map",type:"add",value,label:"Onslaught",...extra});
const resolve=(penalty,rules,context={})=>resolveMapPenalty({penalty,rules,context}).penalty;
test("MAP adjustment is flat across penalties, while no MAP remains zero",()=>{
  assert.deepEqual([0,-2,-4].map(p=>resolve(p,[rule(-1)])),[0,-1,-3]);
});
test("MAP reduction cannot become a bonus; positive changes increase penalties",()=>{
  assert.deepEqual([0,-2,-4].map(p=>resolve(p,[rule(-5)])),[0,0,0]);
  assert.deepEqual([0,-2,-4].map(p=>resolve(p,[rule(1)])),[0,-3,-5]);
});
test("MAP rule conditions use the owner's current flag context",()=>{
  const r=rule(-1,{predicate:{op:"flag",source:"actor",flag:"aggressive-stance"},ownerFlags:["aggressive-stance"]});
  assert.equal(resolve(-2,[r],{hasRoll:true}),-1);
  assert.equal(resolve(-2,[{...r,ownerFlags:[]}],{hasRoll:true}),-2);
});
test("MAP ignores unrelated changes and honors operation priority",()=>{
  assert.equal(resolve(-4,[rule(-10,{selector:"outgoing-damage"}),rule(-1)]),-3);
  assert.equal(resolve(-4,[rule(-1),rule(.5,{type:"multiply"})]),-1);
  assert.equal(resolve(-4,[rule(2,{type:"override"})]),-2);
  assert.throws(()=>resolve(-2,[rule("1d6")]),/finite/);
});
