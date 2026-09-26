let resources=[];
const search=document.getElementById('resource-search'), kind=document.getElementById('resource-kind');
function render(){
 const words=search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
 const rows=resources.filter(r=>(kind.value==='all'||r.kind===kind.value)&&words.every(w=>[r.name,r.description,r.audience,r.kind].join(' ').toLowerCase().includes(w)));
 const target=document.getElementById('resource-results');target.replaceChildren();
 for(const r of rows){const article=document.createElement('article');article.dataset.id=r.id;const first=document.createElement('div'),second=document.createElement('div');
 const tag=document.createElement('div');tag.className='kind';tag.textContent=r.kind;
 const title=document.createElement('h2');const detail=document.createElement('a');detail.href=r.url;detail.textContent=r.name;title.append(detail);const facts=document.createElement('p');facts.className='facts';facts.textContent=({online:'Online',self_paced:'Self-paced',print:'Print',download:'Download',mixed_resources:'Mixed formats'}[r.delivery_mode]||'Resource')+' · '+r.audience;
 first.append(tag,title,facts);const desc=document.createElement('p');desc.textContent=r.description;second.append(desc);
 try{const url=new URL(r.website);if(['http:','https:'].includes(url.protocol)){const link=document.createElement('a');link.href=url.href;link.textContent='Visit provider website';link.rel='noopener noreferrer';second.append(link);}}catch{}
 article.append(first,second);target.append(article);}
 document.getElementById('resource-count').textContent=rows.length+' resource'+(rows.length===1?'':'s');document.getElementById('resource-empty').hidden=rows.length>0;
}
search.addEventListener('input',render);kind.addEventListener('change',render);document.getElementById('resource-reset').addEventListener('click',()=>{search.value='';kind.value='all';render();search.focus()});
fetch('/data/resources.json').then(r=>{if(!r.ok)throw Error('load');return r.json()}).then(d=>{resources=DirectorySections.resources(d.resources||[]);render()}).catch(()=>{document.getElementById('resource-count').textContent='';document.getElementById('resource-error').hidden=false});
