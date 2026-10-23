/* "Request info" dialog for microschool.directory listings.
   A parent writes to a school; we store the request through the Turnstile-verified
   submit-inquiry edge function and pass it to that school. Nothing is sent until the
   consent box is checked. One request key per attempt makes retries idempotent.
   GA4 gets only the listing id, channel and page source (see /assets/msd-track.js).

   Progressive enhancement: every trigger is a real mailto link to hello@. While
   CFG.enabled is false (phase 1, before the function and table are live) the link
   works as plain email and only the click is counted. For QA on the live site before
   the switch: localStorage.setItem("msd-inquiry-preview", "1"). */
(function () {
  "use strict";
  if (window.MSDInquiry) return;

  var CFG = {
    enabled: false,
    endpoint: "https://fhbczvfrsgkbpvammxip.supabase.co/functions/v1/submit-inquiry",
    // Public anon key (same one the listing form uses). The inquiries table has no
    // anon policies; only the edge function's service role can write it.
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoYmN6dmZyc2drYnB2YW1teGlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjg1NjUsImV4cCI6MjA5NzgwNDU2NX0.LNl2t1-cAYPny71aKHeZK094Zf_YawnKMvo8W15NQuE", // # secretscan:allow public Supabase anon key (role=anon), same key the homepage form ships
    sitekey: "0x4AAAAAADr7kfdQ2qHuYk8v",
    contact: "hello@microschool.directory",
    consentVersion: "MSD-PRIVACY-2026-10-23",
    timeoutMs: 25000
  };
  var GRADES = ["", "Pre-K", "K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "Multiple or not sure"];
  var ID_RE = /^[A-Za-z0-9_\-]{1,120}$/;
  var S = { root: null, listing: null, key: null, widget: null, busy: false, lastFocus: null, done: false, dirty: false, gen: 0, inerted: [] };

  function enabled() {
    if (CFG.enabled) return true;
    try { return window.localStorage.getItem("msd-inquiry-preview") === "1"; } catch (_) { return false; }
  }
  function track(name, params) { if (window.msdTrack) window.msdTrack(name, params); }
  function chars(s) { return Array.from(s).length; }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var x = Array.prototype.map.call(b, function (n) { return (n + 256).toString(16).slice(1); }).join("");
    return x.slice(0, 8) + "-" + x.slice(8, 12) + "-" + x.slice(12, 16) + "-" + x.slice(16, 20) + "-" + x.slice(20);
  }

  // Must match CONSENT in supabase/functions/submit-inquiry/index.ts for this version.
  function consentText(name) {
    return "Share my name, email, phone (if given), learner grade and message with " + name + " so they can reply to me.";
  }

  function injectCss() {
    if (document.getElementById("msd-inq-css")) return;
    var s = document.createElement("style");
    s.id = "msd-inq-css";
    s.textContent = [
      ".msd-inq-bg{position:fixed;inset:0;background:rgba(19,36,29,.55);z-index:9998;display:flex;align-items:center;justify-content:center;padding:18px}",
      ".msd-inq{background:var(--card,#fffdf8);color:var(--ink,#13241d);width:100%;max-width:520px;max-height:calc(100vh - 36px);max-height:calc(100dvh - 36px);overflow:auto;border-radius:20px;padding:26px 24px 22px;box-shadow:0 24px 60px rgba(19,36,29,.25);font-family:var(--sans,-apple-system,sans-serif);position:relative;outline:none}",
      ".msd-inq *{box-sizing:border-box}",
      ".msd-inq h2{font-family:var(--serif,Georgia,serif);font-weight:500;font-size:1.45rem;line-height:1.2;margin:0 34px 6px 0}",
      ".msd-inq .sub{font-size:.9rem;color:var(--ink-2,#1b3a2f);opacity:.8;margin:0 0 16px}",
      ".msd-inq label{display:block;font-size:.86rem;font-weight:600;margin:12px 0 5px}",
      /* 16px keeps iOS Safari from zooming the page on focus */
      ".msd-inq input[type=text],.msd-inq input[type=email],.msd-inq input[type=tel],.msd-inq select,.msd-inq textarea{width:100%;border:1.5px solid var(--line,#d9d0bf);border-radius:12px;padding:11px 12px;font:inherit;font-size:16px;background:#fff;color:inherit}",
      ".msd-inq [aria-invalid=true]{border-color:#a3361a}",
      ".msd-inq textarea{min-height:110px;resize:vertical}",
      ".msd-inq .hint{font-size:.78rem;opacity:.75;margin:5px 0 0}",
      ".msd-inq .two{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}",
      ".msd-inq .consent{display:flex;gap:10px;align-items:flex-start;font-weight:400;font-size:.86rem;line-height:1.45;margin-top:14px;text-transform:none;letter-spacing:normal}",
      /* host pages style every input as a full-width block; pin the checkbox back */
      ".msd-inq .consent input[type=checkbox]{display:inline-block;width:18px;min-width:18px;height:18px;margin:2px 0 0;padding:0;flex:0 0 18px}",
      ".msd-inq .consent span{flex:1 1 auto;min-width:0}",
      ".msd-inq .consent a,.msd-inq .msg a{color:var(--coral-deep,#c64a26);text-decoration:underline}",
      ".msd-inq .msd-ts{margin:14px 0 4px;min-height:65px}",
      ".msd-inq .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}",
      ".msd-inq .send{display:block;width:100%;margin-top:12px;padding:13px;border:0;border-radius:100px;background:var(--coral,#e8643c);color:#fff;font:inherit;font-weight:600;font-size:.95rem;cursor:pointer}",
      ".msd-inq .send[disabled]{opacity:.6;cursor:wait}",
      ".msd-inq .msg{font-size:.88rem;margin-top:10px;min-height:1em}",
      ".msd-inq .msg.err{color:#a3361a}",
      ".msd-inq .x{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;border:1.5px solid var(--line,#d9d0bf);background:transparent;font-size:1.1rem;line-height:1;cursor:pointer;color:inherit}",
      ".msd-inq .ok{text-align:center;padding:18px 4px 6px;outline:none}",
      ".msd-inq .ok b{display:block;font-family:var(--serif,Georgia,serif);font-size:1.35rem;color:var(--forest,#285c46);margin-bottom:8px}",
      ".msd-inq .fine{font-size:.78rem;opacity:.7;margin-top:12px}",
      "@media(max-width:560px){.msd-inq-bg{align-items:flex-end;padding:0}.msd-inq{border-radius:20px 20px 0 0;max-height:92vh;max-height:92dvh}.msd-inq .two{grid-template-columns:1fr}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    for (var k in props || {}) {
      if (k === "text") n.textContent = props[k];
      else n.setAttribute(k, props[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function field(label, input, hint) {
    var id = "msd-inq-" + input.getAttribute("name");
    input.id = id;
    var kids = [el("label", { "for": id, text: label }), input];
    if (hint) { kids.push(el("p", { "class": "hint", id: id + "-hint", text: hint })); input.setAttribute("aria-describedby", id + "-hint"); }
    return el("div", {}, kids);
  }

  function build(listing) {
    var bg = el("div", { "class": "msd-inq-bg" });
    var box = el("div", { "class": "msd-inq", role: "dialog", "aria-modal": "true", "aria-labelledby": "msd-inq-title", tabindex: "-1" });
    var close = el("button", { type: "button", "class": "x", "aria-label": "Close", text: "×" });
    var title = el("h2", { id: "msd-inq-title", text: "Ask " + listing.name + " a question" });
    var sub = el("p", { "class": "sub", text: "Tuition, openings, tours, schedules: send your question and the school replies to you by email." });

    var form = el("form", { novalidate: "novalidate" });
    var grade = el("select", { name: "learner_grade" });
    GRADES.forEach(function (g) { grade.appendChild(el("option", { value: g, text: g ? (g === "Pre-K" || g === "K" || g.length > 3 ? g : "Grade " + g) : "Choose (optional)" })); });
    var consent = el("input", { type: "checkbox", name: "consent", required: "required" });
    var consentLabel = el("label", { "class": "consent" }, [consent, el("span", { text: consentText(listing.name) + " " })]);
    consentLabel.lastChild.appendChild(el("a", { href: "/privacy/", target: "_blank", rel: "noopener", text: "Privacy policy" }));

    form.appendChild(field("Your name", el("input", { type: "text", name: "parent_name", required: "required", maxlength: "120", autocomplete: "name" })));
    form.appendChild(el("div", { "class": "two" }, [
      field("Email", el("input", { type: "email", name: "parent_email", required: "required", maxlength: "200", autocomplete: "email" })),
      field("Phone (optional)", el("input", { type: "tel", name: "parent_phone", maxlength: "40", autocomplete: "tel" }))
    ]));
    form.appendChild(field("Grade your learner is entering", grade));
    var msg = el("textarea", { name: "message", required: "required", minlength: "10", maxlength: "2000" });
    msg.placeholder = "Hi! We're interested in your school. Could you share tuition, schedule, and whether you have openings?";
    form.appendChild(field("Your question", msg, "Please leave out your child's name, health or school records. The school can ask for what it needs when it replies."));
    // Honeypot. A name no autofill profile maps to, and password managers told to skip it.
    form.appendChild(el("div", { "class": "hp", "aria-hidden": "true" }, [
      el("label", { "for": "msd-inq-hp", text: "Leave this empty" }),
      el("input", { type: "text", id: "msd-inq-hp", name: "msd_hp_field", tabindex: "-1", autocomplete: "off", "data-1p-ignore": "true", "data-lpignore": "true", "data-form-type": "other" })
    ]));
    form.appendChild(consentLabel);
    form.appendChild(el("div", { "class": "msd-ts" }));
    form.appendChild(el("button", { type: "submit", "class": "send", text: "Send request" }));
    form.appendChild(el("div", { "class": "msg", id: "msd-inq-msg", role: "status", "aria-live": "polite" }));
    form.appendChild(el("p", { "class": "fine", text: "We pass your request to this school only. We never sell your information." }));

    box.appendChild(close); box.appendChild(title); box.appendChild(sub); box.appendChild(form);
    bg.appendChild(box);
    close.addEventListener("click", function () { hide(); });
    // A stray backdrop tap shouldn't throw away a half-written question.
    bg.addEventListener("mousedown", function (e) { if (e.target === bg && !S.dirty) hide(); });
    form.addEventListener("input", function () { S.dirty = true; });
    form.addEventListener("submit", submit);
    return bg;
  }

  function onKey(e) {
    if (!S.root) return;
    if (e.key === "Escape") {
      // Keep the page's own Escape handlers (the map drawer) from also firing.
      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      hide(); return;
    }
    if (e.key !== "Tab") return;
    var f = S.root.querySelectorAll("button,input:not([tabindex='-1']),select,textarea,a[href],iframe");
    var list = Array.prototype.filter.call(f, function (n) { return n.offsetParent !== null && !n.disabled; });
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    if (!S.root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function setInert(on) {
    if (on) {
      S.inerted = Array.prototype.filter.call(document.body.children, function (n) {
        return n !== S.root && n.tagName !== "SCRIPT" && !n.hasAttribute("inert");
      });
      S.inerted.forEach(function (n) { n.setAttribute("inert", ""); });
    } else {
      S.inerted.forEach(function (n) { n.removeAttribute("inert"); });
      S.inerted = [];
    }
  }

  function whenTurnstile(cb) {
    if (window.turnstile && window.turnstile.render) return cb();
    var started = Date.now();
    if (!document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) {
      var t = document.createElement("script");
      t.async = true;
      t.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      document.head.appendChild(t);
    }
    (function wait() {
      if (window.turnstile && window.turnstile.render) return cb();
      if (Date.now() - started > 15000) return cb(new Error("captcha unavailable"));
      setTimeout(wait, 150);
    })();
  }

  function renderWidget(gen) {
    whenTurnstile(function (err) {
      if (!S.root || S.gen !== gen) return;
      var box = S.root.querySelector(".msd-ts");
      if (err) { say("The spam check didn't load. Refresh the page, or email us.", true, true); return; }
      try { S.widget = window.turnstile.render(box, { sitekey: CFG.sitekey, action: "inquiry", size: "flexible" }); }
      catch (_) { say("The spam check didn't load. Refresh the page, or email us.", true, true); }
    });
  }

  function mailtoHref(name) {
    return "mailto:" + CFG.contact + "?subject=" + encodeURIComponent("Inquiry about " + (name || "a school"));
  }

  function say(text, isErr, withMail) {
    var m = S.root && S.root.querySelector(".msg");
    if (!m) return;
    m.className = "msg" + (isErr ? " err" : "");
    m.textContent = text;
    if (withMail) {
      m.appendChild(document.createTextNode(" "));
      m.appendChild(el("a", { href: mailtoHref(S.listing && S.listing.name), text: "Email " + CFG.contact }));
    }
  }

  function invalid(f, name, text) {
    var n = f.elements[name];
    if (n) { n.setAttribute("aria-invalid", "true"); n.setAttribute("aria-errormessage", "msd-inq-msg"); n.focus(); }
    say(text, true);
  }

  function open(listing) {
    if (!listing || !ID_RE.test(listing.id || "") || !listing.name) return false;
    if (S.root) hide(true);
    injectCss();
    S.gen += 1;
    S.listing = { id: listing.id, name: String(listing.name).slice(0, 160), source: listing.source === "map_drawer" ? "map_drawer" : "listing_page" };
    S.key = uuid(); S.done = false; S.busy = false; S.dirty = false;
    S.lastFocus = document.activeElement;
    S.root = build(S.listing);
    document.body.appendChild(S.root);
    setInert(true);
    window.addEventListener("keydown", onKey, true);
    document.documentElement.style.overflow = "hidden";
    var first = S.root.querySelector("input[name=parent_name]");
    if (first) first.focus(); else S.root.querySelector(".msd-inq").focus();
    renderWidget(S.gen);
    track("inquiry_open", { listing_id: S.listing.id, source: S.listing.source, channel: "form" });
    return true;
  }

  // force: replace or tear down even mid-send (the response is then ignored via S.gen).
  function hide(force) {
    if (!S.root) return;
    if (S.busy && force !== true) { say("Sending… one moment.", false); return; }
    S.gen += 1; S.busy = false;
    try { if (S.widget != null && window.turnstile) window.turnstile.remove(S.widget); } catch (_) {}
    S.widget = null;
    window.removeEventListener("keydown", onKey, true);
    setInert(false);
    S.root.parentNode.removeChild(S.root);
    S.root = null;
    document.documentElement.style.overflow = "";
    if (S.lastFocus && S.lastFocus.focus) { try { S.lastFocus.focus(); } catch (_) {} }
  }

  function resetWidget() { try { if (S.widget != null && window.turnstile) window.turnstile.reset(S.widget); } catch (_) {} }

  function showDone(email) {
    var form = S.root.querySelector("form");
    var ok = el("div", { "class": "ok", tabindex: "-1" }, [
      el("b", { text: "Request received" }),
      el("p", { text: "We'll pass your question to " + S.listing.name + ". Replies come from the school to " + email + "." })
    ]);
    form.parentNode.replaceChild(ok, form);
    ok.focus();
  }

  async function submit(e) {
    e.preventDefault();
    if (S.busy || S.done) return;
    var gen = S.gen;
    var f = e.target, v = function (n) { return (f.elements[n] && f.elements[n].value || "").trim(); };
    Array.prototype.forEach.call(f.querySelectorAll("[aria-invalid]"), function (n) { n.removeAttribute("aria-invalid"); n.removeAttribute("aria-errormessage"); });
    var data = {
      request_key: S.key, school_id: S.listing.id, school_name: S.listing.name, source: S.listing.source,
      page_url: location.origin + location.pathname,
      parent_name: v("parent_name"), parent_email: v("parent_email"), parent_phone: v("parent_phone"),
      learner_grade: v("learner_grade"), message: v("message"), hp_field: v("msd_hp_field"),
      consent_share: !!f.elements.consent.checked, consent_text: consentText(S.listing.name), consent_version: CFG.consentVersion
    };
    if (!data.parent_name) return invalid(f, "parent_name", "Please add your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.parent_email)) return invalid(f, "parent_email", "Please check your email address.");
    if (data.parent_phone && !/^[0-9+().\-\s]{7,40}$/.test(data.parent_phone)) return invalid(f, "parent_phone", "Please check your phone number, or leave it blank.");
    if (chars(data.message) < 10) return invalid(f, "message", "Please write a short question (at least 10 characters).");
    if (chars(data.message) > 2000) return invalid(f, "message", "Please keep your question under 2,000 characters.");
    if (!data.consent_share) return invalid(f, "consent", "Please check the box so we can share your request with the school.");
    var token = "";
    try { token = window.turnstile && S.widget != null ? window.turnstile.getResponse(S.widget) : ""; } catch (_) {}
    if (!token) return say("Please finish the spam check above, then send.", true);
    data.turnstileToken = token;

    var btn = f.querySelector(".send");
    S.busy = true; btn.disabled = true; say("Sending…", false);
    var res = null, body = {};
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, CFG.timeoutMs) : null;
    try {
      res = await fetch(CFG.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey },
        body: JSON.stringify(data),
        signal: ctl ? ctl.signal : undefined
      });
      try { body = await res.json(); } catch (_) { body = {}; }
    } catch (_) { res = null; }
    if (timer) clearTimeout(timer);
    if (S.gen !== gen || !S.root) return; // dialog closed or reopened meanwhile
    S.busy = false; btn.disabled = false; resetWidget();

    if (res && res.ok && body.ok) {
      S.done = true;
      track("inquiry_submit_success", { listing_id: S.listing.id, source: S.listing.source });
      return showDone(data.parent_email);
    }
    if (res && res.status === 409 && body.code === "duplicate_today") {
      S.done = true;
      return say("You already sent " + S.listing.name + " a request today. Replies go to " + data.parent_email + ".", false);
    }
    if (res && res.status === 409 && body.code === "key_conflict") {
      S.key = uuid();
      return say("Your details changed since the last try. Please press Send once more.", true);
    }
    if (res && (res.status === 400 || res.status === 422)) return say(String(body.error || "Please check the form and try again.").slice(0, 200), true);
    if (res && res.status === 403) return say("The spam check didn't pass. Please try it again.", true);
    if (res && res.status === 413) return say("That's too long to send. Please shorten your question.", true);
    say("We couldn't confirm your request went through. Try again; it won't be sent twice.", true, true);
  }

  document.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest("[data-inquiry]") : null;
    if (!b) return;
    var listing = { id: b.getAttribute("data-listing"), name: b.getAttribute("data-name"), source: b.getAttribute("data-source") };
    var plain = ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey;
    if (plain && enabled() && open(listing)) { ev.preventDefault(); return; }
    // Phase 1, modified clicks, or a bad listing: the mailto link does its normal job.
    if (ID_RE.test(listing.id || "")) track("inquiry_open", { listing_id: listing.id, source: listing.source === "map_drawer" ? "map_drawer" : "listing_page", channel: "mailto" });
  });

  window.MSDInquiry = { open: open, close: function () { hide(); }, enabled: enabled };
})();
