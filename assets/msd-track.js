/* microschool.directory GA4 interaction events.
   Sends listing ids, channel names and page types only. Never names, emails,
   phone numbers, messages or URLs with query strings. Event names are allow-listed;
   markup opts in with data-track / data-listing / data-channel / data-partner. */
(function () {
  "use strict";
  if (window.msdTrack) return;

  var EVENTS = /^(provider_contact_click|claim_cta_click|list_school_cta_click|affiliate_click|inquiry_open|inquiry_submit_success|listing_submit_success|claim_submit_success)$/;
  var SAFE = /^[A-Za-z0-9_\-]{1,120}$/;

  function pageType() {
    var p = location.pathname;
    if (p === "/" || p === "/index.html") return "home";
    if (/^\/microschools\/[^/]+\/[^/]+\/[^/]+\/$/.test(p)) return "listing";
    if (/^\/microschools\/[^/]+\/[^/]+\/$/.test(p)) return "city";
    if (/^\/microschools\/[^/]+\/$/.test(p)) return "state";
    if (/^\/blog\//.test(p)) return "blog";
    if (/^\/claim\//.test(p)) return "claim";
    return "other";
  }

  function clean(params) {
    var out = { page_type: pageType() };
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k) && SAFE.test(String(params[k]))) out[k] = String(params[k]);
    }
    return out;
  }

  function send(name, params) {
    if (!EVENTS.test(name)) return;
    try {
      if (typeof window.gtag === "function") window.gtag("event", name, clean(params || {}));
    } catch (_) { /* analytics must never break the page */ }
  }
  window.msdTrack = send;

  function attr(el, n) { return el.getAttribute(n) || ""; }

  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var el = t.closest("[data-track]");
    if (el) {
      send(attr(el, "data-track"), {
        listing_id: attr(el, "data-listing"),
        channel: attr(el, "data-channel"),
        partner: attr(el, "data-partner"),
        source: attr(el, "data-source")
      });
      return;
    }
    var a = t.closest("a[href]");
    if (a && /(^|\/)#register$/.test(a.getAttribute("href") || "")) send("list_school_cta_click", {});
  }, true);
})();
