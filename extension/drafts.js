export const initialState = () => ({selectedProjectId:'default',drafts:{}});
export const emptyDraft = () => ({text:'',contexts:[],sessionId:null});
export function updateDraft(state,projectId,patch){return {...state,drafts:{...state.drafts,[projectId]:{...emptyDraft(),...state.drafts[projectId],...patch}}};}
export function addContext(state,projectId,context,allowDuplicate=false){
 if(typeof context.text!=='string'||!context.text.trim())throw Error('请先在网页中选中文字');
 if(context.text.length>20000)throw Error(`选中文字共 ${context.text.length} 字，超过 20000 字限制，请缩短后添加`);
 const draft=state.drafts[projectId]||emptyDraft();
 if(!allowDuplicate&&draft.contexts.some(c=>c.text===context.text&&c.url===context.url))return {state,status:'duplicate'};
 if(draft.contexts.length>=20)throw Error('每份草稿最多添加 20 条引用');
 return {state:updateDraft(state,projectId,{contexts:[...draft.contexts,context]}),status:'added'};
}
export function clearSnapshot(state,projectId,snapshot){const draft=state.drafts[projectId]||emptyDraft();const ids=new Set(snapshot.contexts.map(c=>c.id));return updateDraft(state,projectId,{text:draft.text===snapshot.text?'':draft.text,contexts:draft.contexts.filter(c=>!ids.has(c.id))});}
