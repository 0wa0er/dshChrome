import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, updateDraft, addContext, clearSnapshot} from '../extension/drafts.js';
test('drafts stay isolated across projects',()=>{const s=updateDraft(initialState(),'a',{text:'alpha'}); assert.equal(updateDraft(s,'b',{text:'beta'}).drafts.a.text,'alpha');});
test('selection validates limits and duplicates without changing draft',()=>{let s=initialState(); const c={id:'one',text:'quote',url:'https://example.com',title:'Example',capturedAt:1}; s=addContext(s,'default',c).state; assert.equal(addContext(s,'default',{...c,id:'two'}).status,'duplicate'); assert.throws(()=>addContext(s,'default',{...c,text:'x'.repeat(20001)}),/20000/); assert.throws(()=>addContext(s,'default',{...c,text:'  '}),/选中/); for(let i=1;i<20;i++)s=addContext(s,'default',{...c,id:String(i),text:String(i)}).state; assert.throws(()=>addContext(s,'default',{...c,text:'extra'}),/20/);});
test('acknowledgement clears only sent snapshot and preserves newer edits',()=>{const c={id:'one',text:'a',url:'https://example.com'};let s=addContext(updateDraft(initialState(),'default',{text:'sent'}),'default',c).state;const snapshot=structuredClone(s.drafts.default);s=updateDraft(s,'default',{text:'new edit',contexts:[c,{...c,id:'two'}]});const d=clearSnapshot(s,'default',snapshot).drafts.default;assert.equal(d.text,'new edit');assert.deepEqual(d.contexts.map(c=>c.id),['two']);assert.equal(clearSnapshot(updateDraft(initialState(),'default',{text:'sent'}),'default',{text:'sent',contexts:[]}).drafts.default.text,'');});

test('background persists queued selection before opening and serializes competing draft edits',async()=>{
 const listeners={};let stored={},opened=false;const events=[];
 globalThis.chrome={storage:{local:{async get(key){return {[key]:structuredClone(stored[key])};},async set(patch){await new Promise(r=>setTimeout(r,2));Object.assign(stored,structuredClone(patch));events.push('persist');}}},runtime:{id:'test',onInstalled:{addListener(){}},onMessage:{addListener(fn){listeners.message=fn;}},async sendMessage(){},getManifest(){return {version:'0.1.0'};}},contextMenus:{create(){},onClicked:{addListener(fn){listeners.click=fn;}}},sidePanel:{setPanelBehavior(){},async open(){assert.equal(stored.dshChromeState.drafts.default.contexts[0].text,'selected');events.push('open');opened=true;}},tabs:{async query(){return [{id:1,title:'Page',url:'https://example.com'}];}},scripting:{async executeScript(){return [{result:'frame selection'}];}}};
 await import('../extension/background.js');
 const message=(type,extra={})=>new Promise(resolve=>listeners.message({type,...extra},{id:'test'},resolve));
 listeners.click({menuItemId:'dsh-add-selection',selectionText:'selected',pageUrl:'https://example.com'},{windowId:1,title:'Page'});
 await message('draft.patch',{projectId:'default',text:'typed while capturing'});
 for(let i=0;!opened&&i<30;i++)await new Promise(r=>setTimeout(r,3));
 assert.equal(opened,true);assert.ok(events.indexOf('persist')<events.indexOf('open'));
 assert.equal(stored.dshChromeState.drafts.default.text,'typed while capturing');
 assert.equal(stored.dshChromeState.drafts.default.contexts.length,1);
 const result=await message('selection.capture');assert.equal(result.status,'added');assert.equal(result.state.drafts.default.contexts[1].text,'frame selection');
 const duplicate=await message('selection.capture');assert.equal(duplicate.status,'duplicate');
 assert.equal(listeners.message({type:'draft.get'},{id:'other'},()=>{}),undefined);
 chrome.action={async setBadgeText({text}){events.push('badge:'+text);},async setTitle(){}};
 chrome.sidePanel.open=async()=>{throw Error('gesture expired');};
 listeners.click({menuItemId:'dsh-add-selection',selectionText:'saved despite opening failure',pageUrl:'https://example.com'},{windowId:1,title:'Page'});
 for(let i=0;!events.includes('badge:1')&&i<40;i++)await new Promise(r=>setTimeout(r,3));
 assert.ok(events.includes('badge:1'));assert.match(stored.dshCaptureNotice.message,/已保存/);assert.equal(stored.dshChromeState.drafts.default.contexts.at(-1).text,'saved despite opening failure');
 const denied=await new Promise(resolve=>listeners.message({type:'rpc',method:'installation.ensureCompanion',params:{target:'host',userInitiated:true}},{id:'test',tab:{id:1},url:'https://example.com'},resolve));assert.match(denied.error.message,/侧栏/);

});


test('session selection ignores stale replies after project switching',async()=>{
 const elements=new Map();function element(){return {value:'',hidden:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},replaceChildren(){},append(){},add(){},textContent:'',scrollHeight:0};}
 globalThis.document={activeElement:null,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};globalThis.Option=function(text,value){return {text,value};};
 let current={selectedProjectId:'default',drafts:{default:{text:'',contexts:[],sessionId:null},other:{text:'other draft',contexts:[],sessionId:null}}};let delayedResolve=null,delay=false;
 globalThis.chrome={runtime:{getManifest(){return {version:'0.1.0'};},onMessage:{addListener(){}},async sendMessage(m){if(m.type==='draft.get'){if(delay){delay=false;return new Promise(resolve=>delayedResolve=()=>resolve({state:{selectedProjectId:'default',drafts:{default:{text:'',contexts:[],sessionId:'s1'}}}}));}return {state:structuredClone(current)};}if(m.type==='draft.select'){current.selectedProjectId=m.projectId;return {state:current};}if(m.type==='draft.patch'){current.drafts[m.projectId].sessionId=m.sessionId;return {state:current};}if(m.type==='rpc'){if(m.method==='projects.list')return {result:{projects:[{id:'default',title:'Default',isDefault:true},{id:'other',title:'Other'}]}};if(m.method==='sessions.list')return {result:{sessions:[]}};if(m.method==='sessions.read')return {result:{session:{projectId:'default'},messages:[],running:false}};return {result:{}};}}},storage:{local:{async get(){return {};}}}};
 await import('../extension/sidepanel.js');
 elements.get('session').value='s1';await elements.get('session').listeners.change();
 delay=true;elements.get('session').value='s1';const stale=elements.get('session').listeners.change();
 while(!delayedResolve)await new Promise(r=>setTimeout(r,1));
 elements.get('project').value='other';await elements.get('project').listeners.change();delayedResolve();await stale;
 assert.equal(elements.get('project').value,'other');assert.equal(elements.get('input').value,'other draft');
});
