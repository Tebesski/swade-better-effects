// UI and real-roll coverage for v0.2.0. Disposable effects-qa world only.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", msg => { if (msg.type() === "error" && msg.text().includes("swade-better-effects")) errors.push(msg.text()); });
const id = "swade-better-effects";
const prefix = `Enhancements ${Date.now()}`;
const screenshots = process.env.FOUNDRY_QA_SCREENSHOTS;
const pass = text => console.log(`PASS ${text}`);
async function ready() {
  await page.waitForFunction(() => game?.ready, null, {timeout: 60000});
  assert.equal(await page.evaluate(() => game.world.id), "effects-qa");
  await page.addStyleTag({content: "#notifications {pointer-events:none!important}"});
}
async function closeApps() { await page.evaluate(async () => {for(const app of [...foundry.applications.instances.values()]) if(app.document || app.rows) await app.close();}); }
async function openDetails(selector) { if (!await page.locator(selector).evaluate(e=>e.open)) await page.locator(`${selector} > summary`).click(); }
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label:"Gamemaster"});
  await page.getByRole("button",{name:"Join Game Session",exact:true}).click();await ready();
  await page.evaluate(async id => { await game.settings.set("core","moduleConfiguration",{[id]:true,"swade-tools":true,"swade-targeted-damage":true}); await game.settings.set("core","noCanvas",false); },id);
  await page.reload();await ready();
  await page.evaluate(async ({prefix,id}) => {
    globalThis.enh = {api:game.modules.get(id).api, flagModule:await import("/modules/swade-better-effects/scripts/flags.mjs"), rollModule:await import("/modules/swade-better-effects/scripts/roll-context.mjs")};
    enh.pc = await Actor.create({name:`${prefix} Hero`,type:"character",flags:{[id]:{tags:["dodge"]}},system:{attributes:{vigor:{die:{sides:8}}}},items:[{name:"Dodge",type:"edge"},{name:"Elf",type:"ancestry"},{name:"Fire charm",type:"gear",system:{equipStatus:1,quantity:1},flags:{[id]:{tags:["fire"]}},effects:[{name:"Grant fire",transfer:true,system:{changes:[{key:"sbe.modifyFlag",type:"add",value:"fire",phase:"initial"}]}}]}]});
    enh.npc = await Actor.create({name:`${prefix} NPC`,type:"npc",items:[{name:"Shooting",type:"skill",system:{swid:"shooting",attribute:"agility",die:{sides:8}}},{name:"Fighting",type:"skill",system:{swid:"fighting",attribute:"agility",die:{sides:8}}},
      {name:"Bow",type:"weapon",system:{rangeType:1,range:"12/24/48",damage:"11",actions:{skill:"Shooting"}}},
      {name:"Sword, Long",type:"weapon",system:{rangeType:0,damage:"11",actions:{skill:"Fighting"}}}]});
    enh.sword=enh.npc.items.getName("Sword, Long");enh.bow=enh.npc.items.getName("Bow");enh.gear=enh.pc.items.getName("Fire charm");
    const scene=await Scene.create({name:prefix,active:true,width:1600,height:1000,padding:0,grid:{type:1,size:100},tokens:[{name:"Defender",actorId:enh.pc.id,actorLink:true,x:200,y:200,disposition:1},{name:"Attacker",actorId:enh.npc.id,actorLink:true,x:800,y:200,disposition:-1}]});await scene.view();
  },{prefix,id});
  await page.waitForFunction(()=>canvas.ready && canvas.tokens.placeables.some(t=>t.name==="Defender"));
  await page.evaluate(()=>{enh.target=canvas.tokens.placeables.find(t=>t.name==="Defender");enh.target.setTarget(true,{releaseOthers:true});enh.api.openAegis(enh.pc);});
  const wizard=page.locator(".sbe-aegis");await wizard.waitFor();
  await openDetails('.sbe-aegis details[data-category="globalMod"]');
  assert.deepEqual((await wizard.locator('[data-category="globalMod"] button').allTextContents()).map(t=>t.trim()),["Traits","Attack","Gang Up","Damage","All Armor Piercing"]);
  await wizard.getByRole("button",{name:"Traits",exact:true}).click();
  const row0=wizard.locator(".sbe-change").nth(0);
  assert.equal(await row0.getByLabel("Change",{exact:true}).locator("option").count(),6);
  await row0.getByLabel("Change",{exact:true}).selectOption("system.stats.globalMods.agility");await row0.locator("input.value").fill("1");
  await row0.locator(".sbe-condition-details > summary").click();await row0.locator('[data-condition-action="add-condition"]').click();
  await row0.getByLabel("Flag source",{exact:true}).selectOption("item");await row0.getByLabel("Flag",{exact:true}).fill("Sword*");await row0.getByLabel("Flag",{exact:true}).press("Tab");
  assert.equal(await row0.getByLabel("Flag",{exact:true}).inputValue(),"sword*");
  await row0.locator('a[data-action="deleteChange"]').click();
  await openDetails('.sbe-aegis details[data-category="other"]');
  await wizard.getByRole("button",{name:"Modify targeting roll",exact:true}).click();
  const row=wizard.locator(".sbe-change").nth(0);
  await row.getByLabel("Change",{exact:true}).selectOption("sbe.targetRoll.targetAttackRanged");await row.locator("input.value").fill("-2");
  await row.locator(".sbe-condition-details > summary").click();
  await row.locator('[data-condition-action="add-condition"]').click();
  await row.getByLabel("Flag source",{exact:true}).selectOption("actor");await row.getByLabel("Flag",{exact:true}).fill("dodge");await row.getByLabel("Flag",{exact:true}).press("Tab");
  assert.equal(await row.locator("a.sbe-remove-condition i.fa-trash").count(),1);
  const checkbox=wizard.locator('[name="system.conditionalEffect"]');
  await wizard.locator('.conditional > label').click();assert.equal(await checkbox.isChecked(),true);await wizard.locator('.conditional > label').click();
  const layout=await wizard.evaluate(el=>{const grid=el.querySelector(".main-grid");return {overflow:grid.scrollWidth-grid.clientWidth,font:parseFloat(getComputedStyle(el).fontSize),summary:getComputedStyle(el.querySelector("summary")).cursor,input:el.querySelector("input.value").getBoundingClientRect().height};});
  assert.ok(layout.overflow<=1);assert.equal(layout.font,15);assert.equal(layout.summary,"pointer");assert.ok(layout.input<=29);
  assert.ok(await wizard.locator(".conditional").evaluate(el=>{const l=el.querySelector("label").getBoundingClientRect(),c=el.querySelector("input").getBoundingClientRect();return c.y<l.bottom&&l.y<c.bottom;}));
  await wizard.locator('[data-category="other"] > summary').click();
  assert.equal(await wizard.locator('[data-category="other"]').evaluate(el=>el.open),false);
  assert.equal(await wizard.locator('[data-category="other"]').evaluate(el=>el.getAnimations().length),0);
  await wizard.locator(".presets").evaluate(el=>el.scrollTop=0);
  if(screenshots)await wizard.screenshot({path:`${screenshots}/aegis-compact.png`,animations:"disabled"});
  await wizard.locator('button[type="submit"]').click();await wizard.waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>enh.pc.effects.contents[0].system.changes[0].key),"sbe.targetRoll.targetAttackRanged");
  pass("compact native layout, grouped selectors, instant accordions, label clicks and trash links");
  await page.evaluate(()=>enh.api.openAegis(enh.pc,enh.pc.effects.contents[0]));await wizard.waitFor();
  assert.equal(await wizard.getByLabel("Change",{exact:true}).inputValue(),"sbe.targetRoll.targetAttackRanged");await closeApps();
  await page.evaluate(()=>enh.pc.sheet.render({force:true}));
  const pc=page.locator(`#${await page.evaluate(()=>enh.pc.sheet.id)}`);
  await pc.locator('[data-action="tab"][data-tab="effects"]').click();
  const pcFlags=pc.locator('section[data-tab="effects"] .sbe-tags-field');await pcFlags.waitFor();
  assert.equal(await pcFlags.locator("label").textContent(),"Flags");assert.equal(await pcFlags.locator(".hint").count(),0);
  assert.ok((await pcFlags.getByLabel("Flags",{exact:true}).inputValue()).includes("dodge"));
  assert.equal(await pcFlags.evaluate(el=>el.previousElementSibling.classList.contains("effects-list")),true);
  await closeApps();await page.evaluate(()=>enh.npc.sheet.render({force:true}));
  const npc=page.locator(`#${await page.evaluate(()=>enh.npc.sheet.id)}`);const npcInput=npc.locator('.sbe-tags-field input');await npcInput.waitFor();
  assert.ok((await npcInput.boundingBox()).width>=200);assert.equal(await npc.locator('.sbe-tags-field .hint').count(),0);
  await closeApps();await page.evaluate(()=>enh.gear.sheet.render({force:true}));
  const gear=page.locator(`#${await page.evaluate(()=>enh.gear.sheet.id)}`);await gear.locator('[data-action="tab"][data-tab="properties"]').click();
  const gearField=gear.locator('.sbe-tags-field');await gearField.waitFor();assert.equal(await gearField.locator('.hint').count(),0);
  assert.ok((await gearField.locator('input').boundingBox()).width>=130);
  assert.ok(!await page.evaluate(()=>enh.flagModule.documentFlags(enh.pc).includes("fire")));
  await gearField.getByLabel("Flag activation").selectOption("carried");
  await page.waitForFunction(()=>enh.gear.getFlag("swade-better-effects","flagActivation")==="carried");
  assert.ok(await page.evaluate(()=>enh.flagModule.documentFlags(enh.pc).includes("fire")));
  await page.evaluate(()=>enh.gear.update({"system.equipStatus":0}));assert.ok(!await page.evaluate(()=>enh.flagModule.documentFlags(enh.pc).includes("fire")));
  await page.evaluate(()=>enh.gear.update({"system.equipStatus":3}));assert.ok(await page.evaluate(()=>enh.flagModule.documentFlags(enh.pc).includes("fire")));
  await closeApps();
  pass("PC/NPC/gear Flags fields are wide, have no tips, and equipped/carried activation works");
  assert.ok(await page.evaluate(()=>enh.flagModule.documentFlags(enh.sword).includes("sword-long")));
  await page.evaluate(()=>enh.sword.update({name:"Sword, Short"}));
  assert.ok(await page.evaluate(()=>enh.flagModule.documentFlags(enh.sword).includes("sword-short")&&!enh.flagModule.documentFlags(enh.sword).includes("sword-long")));
  await page.evaluate(()=>enh.pc.items.getName("Elf").update({name:"Dwarf"}));
  assert.ok(await page.evaluate(()=>enh.flagModule.documentFlags(enh.pc).includes("dwarf")&&!enh.flagModule.documentFlags(enh.pc).includes("elf")));
  pass("item names and ancestry flags regenerate after edits");
  const hands = await page.evaluate(async()=>{
    await enh.sword.update({"system.equipStatus":4});await enh.bow.update({"system.equipStatus":2});
    const main = enh.flagModule.documentFlags(enh.sword);
    const off = enh.rollModule.makeContext(enh.npc,enh.bow,[],{kind:"trait",skill:enh.npc.items.getName("Shooting")});
    await enh.sword.update({"system.equipStatus":5});
    return {main, off:off.roll, two:enh.flagModule.documentFlags(enh.sword), owner:enh.flagModule.documentFlags(enh.npc)};
  });
  assert.ok(hands.main.includes("main-hand"));assert.ok(hands.off.includes("off-hand"));assert.ok(!hands.off.includes("main-hand"));
  assert.ok(hands.two.includes("two-hands"));assert.ok(!hands.two.includes("main-hand"));assert.ok(!hands.owner.includes("two-hands"));
  pass("hand-state flags stay on their items, and item rolls use the correct weapon's hand");
  const native = await page.evaluate(async()=>{
    const skill=enh.npc.items.getName("Shooting");const roll=await enh.npc.rollSkill(skill.id,{item:enh.bow,suppressChat:true});
    const context=enh.rollModule.messageContext({rolls:[roll],getFlag:()=>undefined});
    const melee=await enh.npc.rollSkill(enh.npc.items.getName("Fighting").id,{item:enh.sword,suppressChat:true});
    const meleeContext=enh.rollModule.messageContext({rolls:[melee],getFlag:()=>undefined});
    return {ranged:context.traitApplied,melee:meleeContext.traitApplied,flags:context.roll};
  });
  assert.equal(native.ranged,-2);assert.equal(native.melee,0);assert.ok(native.flags.includes("ranged"));assert.ok(!native.flags.includes("melee"));
  await page.evaluate(()=>enh.pc.setFlag("swade-better-effects","tags",[]));
  assert.equal(await page.evaluate(async()=>{const r=await enh.npc.rollSkill(enh.npc.items.getName("Shooting").id,{item:enh.bow,suppressChat:true});return enh.rollModule.messageContext({rolls:[r],getFlag:()=>undefined}).traitApplied;}),0);
  await page.evaluate(()=>enh.pc.setFlag("swade-better-effects","tags",["dodge"]));
  pass("native ranged attacks receive -2 from owner Dodge flag; melee and missing Dodge do not");
  const tools=await page.evaluate(async()=>{
    const {default:ItemRoll}=await import("/modules/swade-tools/scripts/class/ItemRoll.js");const {default:Control}=await import("/modules/swade-tools/scripts/class/RollControl.js");
    const r=new ItemRoll(enh.npc,enh.bow);r.useTarget(enh.target.id);await r.rollBaseSkill();
    const c=enh.rollModule.messageContext({rolls:[r.roll],getFlag:()=>undefined});
    const msg=await r.roll.toMessage({speaker:ChatMessage.getSpeaker({actor:enh.npc}),flags:{"swade-tools":{rolltype:"skill",itemroll:enh.bow.id,useactor:enh.npc.id,usetarget:enh.target.id,skill:"Shooting",userof:1}}});enh.traitMessage=msg;
    const control=new Control(msg,$("<li>"),game.user);control.attackTarget(enh.target,6,1);
    return {applied:c.traitApplied,print:control.targetPrint[0].print};
  });
  assert.equal(tools.applied,0);assert.match(tools.print,/Dodge|Effect/);assert.match(tools.print,/-2/);
  pass("SWADE Tools applies targeting changes per target without adding them twice to the shared dice");
  await page.evaluate(async()=>{const r=await enh.bow.rollDamage({suppressChat:true});await r.evaluate();enh.damageMessage=await r.toMessage({speaker:ChatMessage.getSpeaker({actor:enh.npc})});});
  await page.locator('#sidebar-tabs [data-tab="chat"]').click();
  const card=page.locator(`#chat .chat-message[data-message-id="${await page.evaluate(()=>enh.damageMessage.id)}"]`);await card.locator('.sbe-chat-roll-flags > summary').waitFor();
  assert.equal(await card.locator('.sbe-roll-flags button').count(),0);assert.ok((await card.locator('.sbe-flag').allTextContents()).includes("damage"));
  pass("chat cards contain only a list of automatic/custom flags, with no Flags button");
  assert.deepEqual(errors,[]);pass("no browser JavaScript errors");
}catch(error){console.error("Browser errors:",errors);console.error((await page.locator("body").innerText()).slice(-2200));if(screenshots)await page.screenshot({path:`${screenshots}/enhancements-failure.png`}).catch(()=>{});throw error;}
finally{await browser.close();}
