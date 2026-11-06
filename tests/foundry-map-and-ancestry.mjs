// Actual sheet and roll-dialog regression. Disposable effects-qa world only.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE??"playwright");
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE,args:["--enable-unsafe-swiftshader"]});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error"&&m.text().includes("swade-better-effects"))errors.push(m.text());});
const id="swade-better-effects",prefix=`MAP ${Date.now()}`,shots=process.env.FOUNDRY_QA_SCREENSHOTS;
const pass=t=>console.log(`PASS ${t}`);
async function ready(){await page.waitForFunction(()=>game?.ready,null,{timeout:60000});assert.equal(await page.evaluate(()=>game.world.id),"effects-qa");await page.addStyleTag({content:"#notifications{pointer-events:none!important}"});}
async function openActor(){await page.evaluate(()=>fix.actor.sheet.render({force:true}));const app=page.locator(`#${await page.evaluate(()=>fix.actor.sheet.id)}`);await app.locator('[data-action="tab"][data-tab="effects"]').click();return app;}
async function removeHuman(){const app=await openActor();const input=app.locator(".sbe-tags-field input");await input.fill("");await input.press("Tab");await page.waitForFunction(()=>!fix.api.getFlags(fix.actor).includes("human"));return app;}
async function mapDialog(expected,selection){
  await page.evaluate(()=>{fix.pending=fix.actor.rollSkill(fix.actor.items.getName("Fighting").id,{item:fix.sword});});const app=page.locator(".roll-dialog");await app.waitFor();
  assert.deepEqual(await app.locator('input[name="map"]').evaluateAll(inputs=>inputs.map(i=>Number(i.value))),expected);
  assert.deepEqual(await app.locator('label[for="map-2"],label[for="map-4"]').allTextContents(),expected.slice(1).map(String));
  assert.equal(await app.locator(".modifiers .modifier-entry").filter({hasText:"Onslaught"}).count(),0);
  if(selection===undefined){await page.evaluate(async()=>{await [...foundry.applications.instances.values()].find(a=>a.element?.classList.contains("roll-dialog")).close();await fix.pending;});await app.waitFor({state:"hidden"});return;}
  const field=app.locator(`[data-sbe-map-base="${selection}"]`);await field.check();
  await page.evaluate(async()=>{await [...foundry.applications.instances.values()].find(a=>a.element?.classList.contains("roll-dialog")).render({force:true});});
  assert.equal(await app.locator(`[data-sbe-map-base="${selection}"]`).isChecked(),true);
  assert.deepEqual(await app.locator('input[name="map"]').evaluateAll(inputs=>inputs.map(i=>Number(i.value))),expected);
  if(shots)await app.screenshot({path:`${shots}/map-dialog.png`,animations:"disabled"});
  await app.getByRole("button",{name:"Roll",exact:true}).click();await app.waitFor({state:"hidden"});
  return page.evaluate(async()=>{const roll=await fix.pending;return roll.modifiers.filter(m=>m.label===game.i18n.localize("SWADE.MAPenalty.Label")).map(m=>Number(m.value));});
}
try{
  await page.goto(process.env.FOUNDRY_QA_URL??"http://localhost:30001");await page.locator('select[name="userId"]').selectOption({label:"Gamemaster"});await page.getByRole("button",{name:"Join Game Session",exact:true}).click();await ready();
  await page.evaluate(async id=>{await game.settings.set("core","moduleConfiguration",{[id]:true});await game.settings.set("core","noCanvas",true);},id);await page.reload();await ready();
  await page.evaluate(async({id,prefix})=>{globalThis.fix={api:game.modules.get(id).api};fix.actor=await Actor.create({name:prefix,type:"character",system:{details:{species:{name:"Human"}}},items:[{name:"Fighting",type:"skill",system:{swid:"fighting",attribute:"agility",die:{sides:8}}},{name:"Sword",type:"weapon",system:{rangeType:0,equipStatus:4,damage:"11"}}]});fix.sword=fix.actor.items.getName("Sword");},{id,prefix});
  let app=await removeHuman();const ancestry=app.locator('[name="system.details.species.name"]');
  await ancestry.fill("Elf");await ancestry.press("Tab");await page.waitForFunction(()=>fix.api.getFlags(fix.actor).includes("elf"));
  await ancestry.fill("Human");await ancestry.press("Tab");await page.waitForFunction(()=>fix.api.getFlags(fix.actor).includes("human"));
  await removeHuman();await ancestry.fill("Human");await ancestry.press("Tab");
  await app.locator('[name="system.details.archetype"]').fill("Warrior");await app.locator('[name="system.details.archetype"]').press("Tab");
  await page.waitForFunction(()=>fix.actor.system.details.archetype==="Warrior");assert.ok(!await page.evaluate(()=>fix.api.getFlags(fix.actor).includes("human")));
  await page.evaluate(()=>fix.actor.sheet.close());pass("Human → manually removed → Elf → Human restores human; unrelated sheet edits preserve the deletion");
  await page.evaluate(async()=>{[fix.ancestry]=await fix.actor.createEmbeddedDocuments("Item",[{name:"Elf",type:"ancestry"}]);await fix.ancestry.update({name:"Human"});});
  await page.waitForFunction(()=>fix.api.getFlags(fix.actor).includes("human"));await removeHuman();await page.evaluate(()=>fix.actor.sheet.close());
  await page.evaluate(async()=>{await fix.ancestry.update({name:"Elf"});await fix.ancestry.update({name:"Human"});});await page.waitForFunction(()=>fix.api.getFlags(fix.actor).includes("human"));
  await removeHuman();await page.evaluate(async()=>{await fix.actor.sheet.close();await fix.ancestry.delete();});await page.waitForFunction(()=>fix.api.getFlags(fix.actor).includes("human"));
  pass("embedded ancestry renames, replacements and return to the text field also regenerate the current ancestry flag");
  await page.evaluate(()=>fix.sword.sheet.render({force:true}));app=page.locator(`#${await page.evaluate(()=>fix.sword.sheet.id)}`);await app.locator('[data-action="tab"][data-tab="properties"]').click();
  await page.addStyleTag({content:".sbe-tags-field input,.sbe-tags-field select{font-size:18px!important}"});await page.evaluate(()=>document.fonts.ready);
  const row=app.locator(".sbe-tags-field");const layout=await row.evaluate(el=>{const input=el.querySelector("input").getBoundingClientRect(),select=el.querySelector("select"),r=select.getBoundingClientRect(),style=getComputedStyle(select),canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");ctx.font=style.font;return {inputRight:input.right,inputTop:input.top,selectLeft:r.left,selectTop:r.top,width:r.width,needed:ctx.measureText(select.selectedOptions[0].textContent).width+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+24,overflow:el.querySelector(".form-fields").scrollWidth-el.querySelector(".form-fields").clientWidth};});
  assert.ok(layout.selectLeft>=layout.inputRight);assert.ok(Math.abs(layout.selectTop-layout.inputTop)<2);assert.ok(layout.width>=layout.needed);assert.ok(layout.overflow<=1);
  const labelLayout=await row.evaluate(el=>{const label=el.querySelector("label").getBoundingClientRect(),input=el.querySelector("input").getBoundingClientRect();return {labelRight:label.right,inputLeft:input.left,labelTop:label.top,inputTop:input.top};});
  assert.ok(labelLayout.inputLeft>=labelLayout.labelRight,JSON.stringify(labelLayout));
  if(shots)await row.screenshot({path:`${shots}/gear-flags-inline.png`,animations:"disabled"});await page.evaluate(()=>fix.sword.sheet.close());pass("gear dropdown stays right of Flags and fits When equipped at a larger font size");
  await page.evaluate(()=>fix.api.openAegis(fix.actor));app=page.locator(".sbe-aegis");await app.waitFor();await app.locator('[name="name"]').fill("Onslaught");await app.locator('[data-category="other"] > summary').click();await app.getByRole("button",{name:"Add MAP modifier",exact:true}).click();
  await app.locator("input.value").fill("-1");await app.locator(".sbe-condition-details > summary").click();await app.locator('[data-condition-action="add-condition"]').click();await app.getByLabel("Flag source",{exact:true}).selectOption("actor");await app.getByLabel("Flag",{exact:true}).fill("aggressive-stance");await app.getByLabel("Flag",{exact:true}).press("Tab");
  await app.locator('[name="system.conditionalEffect"]').check();await app.locator('button[type="submit"]').click();await app.waitFor({state:"hidden"});
  await page.evaluate(()=>{fix.onslaught=fix.actor.effects.getName("Onslaught");});await mapDialog([0,-2,-4]);
  await page.evaluate(async()=>{[fix.stance]=await fix.actor.createEmbeddedDocuments("ActiveEffect",[{name:"Aggressive Stance",system:{changes:[]}}]);});
  assert.deepEqual(await mapDialog([0,-1,-3],-2),[-1]);assert.deepEqual(await mapDialog([0,-1,-3],-4),[-3]);assert.deepEqual(await mapDialog([0,-1,-3],0),[]);
  pass("conditional Modify MAP changes the native choices to 0/-1/-3, preserves selection, and applies the selected penalty to actual rolls");
  await page.evaluate(()=>fix.stance.update({disabled:true}));await mapDialog([0,-2,-4]);await page.evaluate(async()=>{await fix.stance.update({disabled:false});await fix.onslaught.update({disabled:true});});await mapDialog([0,-2,-4]);
  pass("inactive stance or inactive MAP effect leaves default MAP choices untouched");
  await page.evaluate(async()=>{await fix.onslaught.update({disabled:false});[fix.pacified]=await fix.actor.createEmbeddedDocuments("ActiveEffect",[{name:"Pacified",system:{changes:[{key:"sbe.modifyFlag",type:"subtract",value:"aggressive-stance",phase:"initial"}]}}]);});
  await mapDialog([0,-2,-4]);assert.equal(await page.evaluate(()=>fix.stance.disabled),false);assert.equal(await page.evaluate(()=>fix.stance.active),false);
  await page.evaluate(()=>fix.pacified.delete());await mapDialog([0,-1,-3]);
  pass("automatic effect name flags drive MAP conditions, and suppressing the stance removes the MAP reduction until suppression ends");
  assert.deepEqual(errors,[]);pass("no browser JavaScript errors");
}catch(e){console.error("Browser errors:",errors);if(shots)await page.screenshot({path:`${shots}/map-ancestry-failure.png`}).catch(()=>{});throw e;}finally{await browser.close();}
