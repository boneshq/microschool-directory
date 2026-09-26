/* Classification is explicit. An office address is not an attendance location. */
(function(root){
  function section(record){
    if(record.classification_status !== 'reviewed') return 'legacy';
    if(record.discovery_section === 'resources' && ['online','self_paced','print','download','mixed_resources'].includes(record.delivery_mode)) return 'resources';
    if(record.discovery_section === 'places' && ['in_person','hybrid'].includes(record.delivery_mode) && record.attendance_location_verified === true) return 'places';
    return 'legacy';
  }
  const api={section, places:rows=>rows.filter(r=>section(r)==='places'),resources:rows=>rows.filter(r=>section(r)==='resources')};
  if(typeof module!=='undefined') module.exports=api;
  root.DirectorySections=api;
})(typeof window==='undefined'?globalThis:window);
