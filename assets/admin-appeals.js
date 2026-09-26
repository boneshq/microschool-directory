async function loadAppeals(session){
  const target=document.getElementById('list-appeals');
  try{
    const response=await adminApi('?action=appeals',session);if(!response.ok)throw Error('Appeals could not load');
    const {appeals}=await response.json();target.replaceChildren();
    if(!appeals.length){target.textContent='No appeals awaiting review.';return;}
    for(const appeal of appeals){
      const article=document.createElement('article');article.className='rev';
      const title=document.createElement('h3');title.textContent=appeal.listings?.name||appeal.listing_id;
      const original=document.createElement('p');original.textContent='Original reason: '+(appeal.listings?.decision_reason||'Review original decision history');
      const facts=document.createElement('p');facts.textContent=appeal.explanation;
      const label=document.createElement('label');label.textContent='Human review outcome';
      const outcome=document.createElement('select');for(const [v,t] of [['more_information','Request more information'],['overturned','Return to pending review'],['upheld','Uphold rejection']])outcome.append(new Option(t,v));label.append(outcome);
      const reasonLabel=document.createElement('label');reasonLabel.textContent='Specific reason and next steps';
      const reason=document.createElement('textarea');reason.rows=3;reason.style.width='100%';reasonLabel.append(reason);
      const button=document.createElement('button');button.className='btn';button.textContent='Record human decision';
      const status=document.createElement('p');status.setAttribute('role','status');
      button.addEventListener('click',async()=>{
        if(reason.value.trim().length<12){status.textContent='Add a specific reason before deciding.';return;}
        button.disabled=true;
        try{
          const response=await adminApi('',await freshSession(),{method:'POST',body:{action:'resolve-appeal',id:appeal.id,outcome:outcome.value,reason:reason.value.trim()}});
          const result=await response.json();if(!response.ok)throw Error(result.error);
          status.textContent='Decision saved. Publication and ownership remain separate.';
        }catch(error){status.textContent=error.message;button.disabled=false;}
      });
      article.append(title,original,facts,label,reasonLabel,button,status);target.append(article);
    }
  }catch(error){target.textContent=error.message+'. Refresh to retry.';}
}
