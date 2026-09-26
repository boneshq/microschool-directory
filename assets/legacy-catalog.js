const catalogSearch=document.getElementById('listing-search');
const catalogRows=[...document.querySelectorAll('#existing-listings li')];
function filterCatalog(){
  const q=catalogSearch.value.toLocaleLowerCase().trim();let count=0;
  for(const row of catalogRows){row.hidden=!row.textContent.toLocaleLowerCase().includes(q);if(!row.hidden)count++;}
  document.getElementById('listing-count').textContent=count+' listings';
}
catalogSearch.addEventListener('input',filterCatalog);filterCatalog();
