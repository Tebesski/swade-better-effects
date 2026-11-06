// Run only against the disposable effects-qa world.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_EXECUTABLE,args:["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const id="swade-better-effects",prefix=`Active flags ${Date.now()}`,shots=process.env.FOUNDRY_QA_SCREENSHOTS;
const pass=t=>console.log(`PASS ${t}`);
async function ready(){await page.waitForFunction(()=>game?.ready,null,{timeout:60000});assert.equal(await page.evaluate(()=>game.world.id),"effects-qa");await page.addStyleTag({content:"#notifications{pointer-events:none!important}"});}
async function flagEffect(name,mode,flag){
  await page.evaluate(id=>game.modules.get(id).api.openAegis(active.actor),id);
  const app=page.locator(".sbe-aegis");await app.waitFor();
  assert.equal(await app.locator("details[open]").count(),0);
  await app.locator('[name="name"]').fill(name);
  await app.locator('[data-category="other"] > summary').click();
  await app.getByRole("button",{name:"Add flag rule",exact:true}).click();
  assert.deepEqual(await app.locator(".sbe-change select.type option").allTextContents(),["Add","Suppress"]);
  await app.locator(".sbe-change select.type").selectOption(mode);
  await app.getByLabel("Flag name",{exact:true}).fill(flag);await app.getByLabel("Flag name",{exact:true}).press("Tab");
  assert.equal(await app.locator(".sbe-change .sbe-condition-details").count(),0);
  const size=await app.evaluate(el=>{const r=el.getBoundingClientRect(),grid=el.querySelector(".main-grid");return {width:r.width,height:r.height,overflow:grid.scrollWidth-grid.clientWidth,font:getComputedStyle(el).fontSize};});
  assert.deepEqual({width:size.width,height:size.height},{width:680,height:660});assert.ok(size.overflow<=1);assert.equal(size.font,"15px");
  if(shots)await app.screenshot({path:`${shots}/active-flag-${mode}.png`,animations:"disabled"});
  await app.locator('button[type="submit"]').click();await app.waitFor({state:"hidden"});
  return page.evaluate(name=>active.actor.effects.getName(name).id,name);
}
async function rollDialog(expected){
  await page.evaluate(()=>{active.pending=active.actor.rollSkill(active.actor.items.getName("Fighting").id,{item:active.actor.items.getName("Sword")});});
  const dialog=page.locator(".roll-dialog");await dialog.waitFor();
  const rows=dialog.locator(".modifiers .modifier-entry").filter({hasText:"Onslaught"});assert.equal(await rows.count(),expected?1:0);
  if(expected){assert.equal(await rows.locator('input[type="checkbox"]').isChecked(),true);assert.match(await rows.textContent(),/-1/);}
  await page.evaluate(async()=>{const app=[...foundry.applications.instances.values()].find(a=>a.element?.classList.contains("roll-dialog"));await app.close();await active.pending;});
  await dialog.waitFor({state:"hidden"});
}
try{
  await page.goto(process.env.FOUNDRY_QA_URL??"http://localhost:30001");await page.locator('select[name="userId"]').selectOption({label:"Gamemaster"});await page.getByRole("button",{name:"Join Game Session",exact:true}).click();await ready();
  await page.evaluate(async id=>{await game.settings.set("core","moduleConfiguration",{[id]:true,"swade-targeted-damage":true});await game.settings.set("core","noCanvas",true);},id);await page.reload();await ready();
  await page.evaluate(async({id,prefix})=>{
    const {changeSignature}=await import("/modules/swade-better-effects/scripts/rules.mjs");
    const change={key:"system.stats.globalMods.attack",type:"add",value:"-1",phase:"initial",priority:null};
    globalThis.active={api:game.modules.get(id).api};
    active.actor=await Actor.create({name:prefix,type:"character",flags:{[id]:{tags:["elf","silver"]}},items:[{name:"Fighting",type:"skill",system:{swid:"fighting",attribute:"agility",die:{sides:8}}},{name:"Sword",type:"weapon",system:{rangeType:0,damage:"11"}},
      {name:"Onslaught Edge",type:"edge",effects:[{name:"Onslaught",transfer:true,system:{conditionalEffect:true,changes:[change]},flags:{[id]:{conditions:[{signature:changeSignature(change),predicate:{op:"flag",source:"actor",flag:"aggressive-stance"}}]}}}]}]});
  },{id,prefix});
  const stanceId=await flagEffect("Aggressive Stance","add","Aggressive Stance");
  await page.evaluate(id=>{active.stance=active.actor.effects.get(id);},stanceId);
  assert.ok(await page.evaluate(()=>active.api.getFlags(active.actor).includes("aggressive-stance")));
  await page.waitForFunction(()=>game.settings.get("swade-better-effects","flagLibrary").includes("aggressive-stance"));
  pass("narrower editor, slightly larger text, closed accordions, and Add flag authoring");
  await page.evaluate(()=>active.stance.update({disabled:true}));await rollDialog(false);
  await page.evaluate(()=>active.stance.update({disabled:false}));await rollDialog(true);
  await page.evaluate(()=>active.stance.update({disabled:true}));await rollDialog(false);
  pass("Onslaught is absent when Aggressive Stance is disabled and appears once, enabled, only when its flag is active");
  await page.evaluate(()=>active.stance.update({disabled:false}));
  const removeId=await flagEffect("Hide silver","subtract","silver");await page.evaluate(id=>{active.remove=active.actor.effects.get(id);},removeId);
  assert.ok(!await page.evaluate(()=>active.api.getFlags(active.actor).includes("silver")));
  await page.evaluate(()=>active.actor.sheet.render({force:true}));
  const sheet=page.locator(`#${await page.evaluate(()=>active.actor.sheet.id)}`);await sheet.locator('[data-action="tab"][data-tab="effects"]').click();
  const input=sheet.locator(".sbe-tags-field input");await input.fill(`${await input.inputValue()}, test-flag`);await input.press("Tab");
  await page.waitForFunction(()=>active.actor.getFlag("swade-better-effects","tags").includes("test-flag"));
  assert.deepEqual(await page.evaluate(()=>active.actor.getFlag("swade-better-effects","tags")),["elf","silver","test-flag"]);
  await page.evaluate(async()=>{await active.actor.sheet.close();await active.remove.update({disabled:true});await active.stance.update({disabled:true});});
  assert.ok(await page.evaluate(()=>active.api.getFlags(active.actor).includes("silver")));
  assert.ok(!await page.evaluate(()=>active.api.getFlags(active.actor).includes("aggressive-stance")));
  pass("Suppress flag restores the original flag when disabled; editing actor flags preserves temporary and hidden state correctly");
  await page.evaluate(()=>active.api.openAegis(active.actor,active.stance));const wizard=page.locator(".sbe-aegis");await wizard.waitFor();assert.equal(await wizard.locator("details[open]").count(),0);
  assert.equal(await wizard.getByLabel("Flag name",{exact:true}).inputValue(),"aggressive-stance");await page.evaluate(async()=>{for(const app of foundry.applications.instances.values())if(app.rows)await app.close();await active.remove.delete();await active.stance.delete();});
  await rollDialog(false);pass("saved flag changes reopen correctly; deleting the stance never leaves its modifier in the roll dialog");
  assert.deepEqual(errors,[]);pass("no browser JavaScript errors");
}catch(e){console.error("Browser errors:",errors);if(shots)await page.screenshot({path:`${shots}/active-flags-failure.png`}).catch(()=>{});throw e;}finally{await browser.close();}
