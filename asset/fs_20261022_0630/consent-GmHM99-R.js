var e=`fs:consent`,t=[`fs:openSections`,`fs:farmView`,`fs:battleMute`,`fs:tutCollapsed`,`fs:chatSeen`,`fs:clanClosed`];function n(){try{let t=JSON.parse(localStorage.getItem(e)??`null`);return t&&t.v===1&&Date.now()-t.at<31536e6?t:null}catch{return null}}function r(t){try{localStorage.setItem(e,JSON.stringify({v:1,at:Date.now(),preferences:t}))}catch{}i(),o()}function i(){if(!n()?.preferences)try{for(let e of t)localStorage.removeItem(e)}catch{}}var a=null;function o(){a?.remove(),a=null}var s=`
#fs-consent { position: fixed; z-index: 2147483000; left: 12px; right: 12px; bottom: 12px; display: flex; justify-content: center; pointer-events: none; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #3a2a1f; }
#fs-consent .box { pointer-events: auto; width: min(720px, 100%); background: #f7e6bf; border: 3px solid #1b130d; box-shadow: 0 4px 0 rgba(0,0,0,.3); padding: 14px 16px; display: grid; gap: 10px; }
#fs-consent h2 { margin: 0; font-size: 16px; }
#fs-consent p { margin: 0; }
#fs-consent a { color: #2f6e3a; }
#fs-consent .row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
#fs-consent button { font: inherit; font-weight: 600; cursor: pointer; padding: 7px 14px; border: 2px solid #1b130d; background: #efd6a2; color: #3a2a1f; }
#fs-consent button.primary { background: #5fae4f; color: #fff; }
#fs-consent button:focus-visible { outline: 3px solid #3c5fc0; outline-offset: 2px; }
#fs-consent label { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: start; padding: 8px 10px; background: #fff3cf; border: 2px solid #e0c088; }
#fs-consent label input { margin-top: 3px; width: 18px; height: 18px; }
#fs-consent label small { grid-column: 2; color: #6b5442; }
`;function c(e=!1){if(o(),!document.getElementById(`fs-consent-css`)){let e=document.createElement(`style`);e.id=`fs-consent-css`,e.textContent=s,document.head.appendChild(e)}let t=n();a=document.createElement(`div`),a.id=`fs-consent`,a.innerHTML=`<div class="box" role="dialog" aria-modal="false" aria-labelledby="fs-consent-title">
    <h2 id="fs-consent-title">Cookies and your privacy</h2>
    <p>We use strictly necessary cookies and browser storage to run the game, keep you logged in and stop bots. With your permission we also remember preferences such as sound and camera position. We do not use advertising or tracking cookies. <a href="/cookies.html">Cookie Policy</a> · <a href="/privacy.html">Privacy Policy</a></p>
    <div class="settings" ${e?``:`hidden`}>
      <label><input type="checkbox" checked disabled> <b>Strictly necessary</b><small>Game save, login session, registration payment status and bot protection (Cloudflare Turnstile). Always on.</small></label>
      <label style="margin-top:6px"><input type="checkbox" id="fs-consent-pref" ${t?.preferences===!1?``:`checked`}> <b>Preferences</b><small>Remembers sound, camera position, open panels, language and seen chat messages.</small></label>
    </div>
    <div class="row">
      ${e?`<button type="button" data-c="save">Save choices</button>`:`<button type="button" data-c="settings">Settings</button>`}
      <button type="button" data-c="necessary">Only necessary</button>
      <button type="button" class="primary" data-c="all">Accept all</button>
    </div>
  </div>`,document.body.appendChild(a),a.addEventListener(`click`,e=>{let t=e.target.closest(`[data-c]`)?.dataset.c;t===`all`?r(!0):t===`necessary`?r(!1):t===`settings`?c(!0):t===`save`&&r(document.getElementById(`fs-consent-pref`).checked)})}function l(){i(),n()||c(),document.addEventListener(`click`,e=>{e.target.closest(`[data-consent-open]`)&&(e.preventDefault(),c(!0))}),window.addEventListener(`pagehide`,i)}export{l as t};