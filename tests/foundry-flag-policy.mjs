// Verify actual Flags inputs and SWADE equipment controls in the disposable QA world.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE??"playwright");
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE,args:["--enable-unsafe-swiftshader"]});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const id="swade-better-effects",prefix=`Flag policy ${Date.now()}`,shots=process.env.FOUNDRY_QA_SCREENSHOTS;
const pass=t=>console.log(`PASS ${t}`);
async function ready(){await page.waitForFunction(()=>game?.ready,null,{timeout:60000});assert.equal(await page.evaluate(()=>game.world.id),"effects-qa");await page.addStyleTag({content:"#notifications{pointer-events:none!important}"});}
async function actorField(){await page.evaluate(()=>policy.actor.sheet.render({force:true}));const sheet=page.locator(`#${await page.evaluate(()=>policy.actor.sheet.id)}`);await sheet.locator('[data-action="tab"][data-tab="effects"]').click();return sheet.locator(".sbe-tags-field input");}
try{
  await page.goto(process.env.FOUNDRY_QA_URL??"http://localhost:30001");await page.locator('select[name="userId"]').selectOption({label:"Gamemaster"});await page.getByRole("button",{name:"Join Game Session",exact:true}).click();await ready();
  await page.evaluate(async id=>{await game.settings.set("core","moduleConfiguration",{[id]:true});await game.settings.set("core","noCanvas",true);},id);await page.reload();await ready();
  await page.evaluate(async({id,prefix})=>{
    globalThis.policy={api:game.modules.get(id).api};
    policy.actor=await Actor.create({name:prefix,type:"character",items:[{name:"Elf",type:"ancestry"},{name:"Dodge",type:"edge"},{name:"Blast",type:"power"},
      {name:"Sword, Long",type:"weapon",system:{equipStatus:4,damage:"11",rangeType:0},flags:{[id]:{tags:["fire"]}}},{name:"Mail",type:"armor",system:{equipStatus:1,armor:2}}]});
    policy.sword=policy.actor.items.getName("Sword, Long");policy.uuid=policy.actor.uuid;
  },{id,prefix});
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["elf","size0"]);
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.sword)),["fire","main-hand","sword-long"]);
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor.items.getName("Dodge"))),["dodge"]);
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor.items.getName("Blast"))),["blast"]);
  let input=await actorField();assert.equal(await input.inputValue(),"elf, size0");
  await input.fill("heroic");await input.press("Tab");await page.waitForFunction(()=>policy.actor.getFlag("swade-better-effects","excludedTags")?.includes("elf"));
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["heroic"]);await page.evaluate(()=>policy.actor.sheet.close());
  pass("actors receive ancestry and Size without inheriting item flags");
  await page.evaluate(()=>policy.sword.sheet.render({force:true}));const sheet=page.locator(`#${await page.evaluate(()=>policy.sword.sheet.id)}`);
  await sheet.locator('[data-action="tab"][data-tab="properties"]').click();input=sheet.locator(".sbe-tags-field input");
  await input.fill("fire, main-hand");await input.press("Tab");await page.waitForFunction(()=>policy.sword.getFlag("swade-better-effects","excludedTags")?.includes("sword-long"));
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.sword)),["fire","main-hand"]);
  await input.fill("fire");await input.press("Tab");await page.waitForFunction(()=>policy.sword.getFlag("swade-better-effects","excludedTags")?.includes("main-hand"));
  assert.equal(await input.inputValue(),"fire");
  // Include stale legacy hand tags to verify the equipment update also cleans stored values.
  await page.evaluate(()=>policy.sword.setFlag("swade-better-effects","tags",["fire","off-hand","two-hands"]));
  const states=[[2,"off-hand"],[4,"main-hand"],[5,"two-hands"],[1,"carried"],[0,"stored"]];
  for(const [state,flag] of states){
    await sheet.locator('[name="system.equipStatus"]').selectOption(String(state));
    await page.waitForFunction(state=>policy.sword.system.equipStatus===state,state);
    await page.waitForFunction(flag=>JSON.stringify(policy.api.getFlags(policy.sword))===JSON.stringify(["fire",flag].sort()),flag);
    assert.deepEqual(await page.evaluate(()=>policy.sword.getFlag("swade-better-effects","tags")),["fire"]);
    assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["heroic"]);
  }
  await page.evaluate(()=>policy.sword.sheet.close());
  await page.evaluate(()=>policy.actor.items.getName("Mail").sheet.render({force:true}));
  const armor=page.locator(`#${await page.evaluate(()=>policy.actor.items.getName("Mail").sheet.id)}`);
  await armor.locator('[name="system.equipStatus"]').selectOption("3");
  await page.waitForFunction(()=>policy.actor.items.getName("Mail").system.equipStatus===3);
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor.items.getName("Mail"))),["equipped","mail"]);
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["heroic"]);
  await page.evaluate(()=>policy.actor.items.getName("Mail").sheet.close());
  pass("native equipment dropdown replaces every old equipment flag with exactly one current state");
  const actorId=await page.evaluate(()=>policy.actor.id);await page.reload();await ready();
  await page.evaluate(({id,actorId})=>{globalThis.policy={api:game.modules.get(id).api,actor:game.actors.get(actorId)};policy.sword=policy.actor.items.getName("Sword, Long");},{id,actorId});
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["heroic"]);
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.sword)),["fire","stored"]);
  pass("manual removal of ancestry and item-name flags survives reloads and equipment changes");
  await page.evaluate(async()=>{[policy.stance]=await policy.actor.createEmbeddedDocuments("ActiveEffect",[{name:"Aggressive Stance",system:{changes:[{key:"sbe.modifyFlag",type:"add",value:"aggressive-stance",phase:"initial"}]}}]);});
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["aggressive-stance","heroic"]);
  input=await actorField();await input.fill("heroic");await input.press("Tab");await page.waitForFunction(()=>policy.actor.getFlag("swade-better-effects","excludedTags")?.includes("aggressive-stance"));
  await page.evaluate(async()=>{await policy.actor.sheet.close();await policy.stance.update({disabled:true});await policy.stance.update({disabled:false});});
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["heroic"]);
  input=await actorField();await input.fill("heroic, aggressive-stance");await input.press("Tab");await page.waitForFunction(()=>policy.api.getFlags(policy.actor).includes("aggressive-stance"));
  assert.deepEqual(await page.evaluate(()=>policy.actor.getFlag("swade-better-effects","tags")),["heroic"]);
  await page.evaluate(async()=>{await policy.actor.sheet.close();await policy.stance.update({disabled:true});});assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["heroic"]);
  pass("manually deleted effect flags stay removed through toggles, and can be explicitly re-added");
  await page.evaluate(async()=>{
    [policy.grant]=await policy.sword.createEmbeddedDocuments("ActiveEffect",[{name:"Grant ward",transfer:true,system:{changes:[{key:"sbe.modifyFlag",type:"add",value:"ward",phase:"initial"}]}}]);
    await policy.sword.setFlag("swade-better-effects","flagActivation","carried");await policy.sword.update({"system.equipStatus":1});
    // SWADE automatically disables item effects when it is put away. Flags
    // must still require an explicitly active effect in the carried state.
    await policy.grant.update({disabled:false});
  });
  assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["grant-ward","heroic","ward"]);
  await page.evaluate(()=>policy.sword.setFlag("swade-better-effects","flagActivation","equipped"));assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["heroic"]);
  await page.evaluate(()=>policy.sword.update({"system.equipStatus":4}));assert.deepEqual(await page.evaluate(()=>policy.api.getFlags(policy.actor)),["grant-ward","heroic","ward"]);
  pass("equipped/carried rules allow explicit item effects to grant actor flags, without inheriting the item's own flags");
  assert.deepEqual(errors,[]);pass("no browser JavaScript errors");
}catch(e){console.error("Browser errors:",errors);if(shots)await page.screenshot({path:`${shots}/flag-policy-failure.png`}).catch(()=>{});throw e;}finally{await browser.close();}
