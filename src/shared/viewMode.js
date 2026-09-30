// Phone vs full-site routing (UX-03 Stage 0). A phone opening the app gets /mobile by default;
// "View full site" / "Switch to mobile view" override that per device.
//
// Phone = narrow AND touch-first. `pointer: coarse` keeps a narrowed desktop browser window on
// the full app (fine pointer); the width keeps most tablets there (portrait iPads are 810–1024px
// wide). Known edge: iPad mini (744px) and older 9.7" iPads (768px) in portrait fall inside
// 768px and get /mobile — phones are ≤ ~430px, so lowering this to ~700px would exclude them.
// A phone turned to landscape (>768px) gets the full app. The user-agent isn't used: unreliable.
export const PHONE_QUERY = '(max-width: 768px) and (pointer: coarse)';
export const NARROW_QUERY = '(max-width: 768px)';
const PREF_KEY = 'ledgrly_view'; // 'full' | 'mobile' | unset (= automatic)

export const matches = (q) => { try { return window.matchMedia(q).matches; } catch { return false; } };
export const isPhone = () => matches(PHONE_QUERY);

export function getViewPref() {
  try { return localStorage.getItem(PREF_KEY); } catch { return null; }
}
export function setViewPref(v) {
  try { v ? localStorage.setItem(PREF_KEY, v) : localStorage.removeItem(PREF_KEY); } catch { /* private mode etc. */ }
}

// Should this visit to the full app be sent to /mobile instead?
export const shouldUseMobile = () => isPhone() && getViewPref() !== 'full';

// A bank-connection callback (/?bank_connected=… or ?bank_error=…) returns to /mobile when the
// user chose mobile view on this device — they started the connection from /mobile even if the
// device isn't phone-sized (Stage 2 bank connect).
export const isBankCallback = (search) => /[?&](bank_connected|bank_error)=/.test(search || '');
export const shouldRouteToMobile = (search) => shouldUseMobile() || (isBankCallback(search) && getViewPref() === 'mobile');

export function goToFullSite() { setViewPref('full'); window.location.assign('/'); }
export function goToMobile()   { setViewPref('mobile'); window.location.assign('/mobile'); }
