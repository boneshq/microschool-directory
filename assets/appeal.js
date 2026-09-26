// Public configuration is read from the same existing config as registration.
const form=document.getElementById('appeal-form'),statusText=document.getElementById('appeal-status');
let config,widget,busy=false;
try{const saved=JSON.parse(sessionStorage.getItem('msd-appeal-reference')||'null');if(saved){document.getElementById('reference').value=saved.reference;document.getElementById('appeal-key').value=saved.appeal_key;}}catch{}
fetch('/data/registration-config.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(c=>{
  config=c;window.msdAppealCaptcha=()=>{widget=turnstile.render('#appeal-captcha',{sitekey:c.turnstileSiteKey});};
  const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=msdAppealCaptcha&render=explicit';document.head.append(s);
}).catch(()=>{statusText.textContent='The appeal form is unavailable. Email hello@microschool.directory to request reconsideration.';});
form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!config)return;
  const captcha=window.turnstile?.getResponse(widget);if(!captcha){statusText.textContent='Complete the human verification first.';return;}
  busy=true;form.querySelector('button').disabled=true;
  const fields={reference:document.getElementById('reference').value,appeal_key:document.getElementById('appeal-key').value,explanation:document.getElementById('explanation').value};
  let previous;try{previous=JSON.parse(sessionStorage.getItem('msd-appeal-attempt')||'null');}catch{}
  const signature=JSON.stringify(fields);
  const attempt=previous?.signature===signature?previous:{signature,request_key:crypto.randomUUID()};
  sessionStorage.setItem('msd-appeal-attempt',JSON.stringify(attempt));
  try{
    const response=await fetch(config.supabaseUrl+'/functions/v1/submit-appeal',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabaseAnonKey,Authorization:'Bearer '+config.supabaseAnonKey},body:JSON.stringify({...fields,request_key:attempt.request_key,turnstileToken:captcha})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Appeal could not be saved.');
    sessionStorage.removeItem('msd-appeal-attempt');statusText.textContent='Your appeal is saved for human review. Reference: '+result.appeal_id;form.querySelector('button').hidden=true;
  }catch(error){statusText.textContent=error.message+' You can retry without creating a second appeal.';}
  finally{busy=false;form.querySelector('button').disabled=false;window.turnstile?.reset(widget);}
});
