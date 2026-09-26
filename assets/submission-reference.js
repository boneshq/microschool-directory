/* Browser-held retry/appeal references. No applicant facts are persisted here. */
window.MSDSubmission={
  get(){
    let value;
    try{value=JSON.parse(sessionStorage.getItem('msd-submission-reference')||'null');}catch{}
    if(!value){
      const bytes=crypto.getRandomValues(new Uint8Array(32));
      value={submission_key:crypto.randomUUID(),appeal_key:[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('')};
      sessionStorage.setItem('msd-submission-reference',JSON.stringify(value));
    }
    return value;
  },
  saved(reference){
    const value={...this.get(),reference};
    sessionStorage.setItem('msd-appeal-reference',JSON.stringify(value));
    const panel=document.getElementById('regsuccess');
    if(panel){
      const p=document.createElement('p');p.textContent='Save your submission reference: '+reference;
      const link=document.createElement('a');link.href='/appeal/';link.textContent='Request reconsideration if your listing is rejected';
      const download=document.createElement('a');
      download.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
      download.download='microschool-submission-receipt.json';download.textContent='Download your private submission receipt and appeal key';
      const note=document.createElement('p');note.textContent='Keep this receipt private. It lets you request reconsideration after closing this tab.';
      panel.append(p,download,note,link);
    }
    // Retry key is retired only after the API confirms durable storage.
    sessionStorage.removeItem('msd-submission-reference');
  },
  photos(value){
    const current=this.get();if(value){current.photo_urls=value;sessionStorage.setItem('msd-submission-reference',JSON.stringify(current));}
    return current.photo_urls||null;
  }
};
const sectionInput=document.getElementById('f-section');
if(sectionInput){
  const delivery=document.getElementById('f-delivery'),type=document.getElementById('f-type');
  function updateSection(){
    const resource=sectionInput.value==='resources';
    delivery.replaceChildren(...(resource?['online','self_paced','print','download','mixed_resources']:['in_person','hybrid']).map(v=>new Option(v.replaceAll('_',' '),v)));
    type.replaceChildren(...(resource?['Curriculum & tools','Online programs','Online classes & tutoring']:['Microschool','Homeschool Co-op','Hybrid School','Learning Pod','Tutoring & Enrichment']).map(v=>new Option(v,v)));
    for(const id of ['f-city','f-state'])document.getElementById(id).required=!resource;
    document.getElementById('attendance-help').textContent=resource?'City/state are optional office details and will not create a map pin.':'Enter the attendance city and state. Do not publish a private home address.';
  }
  sectionInput.addEventListener('change',updateSection);updateSection();
}
