/**
 * Per-face localStorage isolation, at the STORAGE LAYER (2026-09-19).
 *
 * THE PROBLEM. A double-sided display hosts its back side as a second WebView
 * in the same Android process, on the same origin — so both panes share ONE
 * `localStorage`. The player keeps its device token, fingerprint, canvas pin,
 * manifest cache and cached emergency there. Unisolated, the back's credential
 * mint overwrites the front's, both panes collapse onto one Screen row in a
 * mutual 401 loop, and — worse — the back's ordinary "no alert" manifest
 * deletes the front's cached lockdown. Three independent verifiers flagged it;
 * Android 7.1 (the DH43) has no per-WebView data directory to lean on.
 *
 * WHY NOT NAMESPACE EACH KEY. That was the first plan (`faceKeys()` in
 * faceStorage.ts). It means editing ~17 call sites inside a 12,000-line page
 * plus the pre-paint inline script in layout.tsx — i.e. touching how EVERY
 * SCREEN IN THE FLEET stores its credential, for the benefit of one hardware
 * class, with a single missed key silently re-opening the hole.
 *
 * So the isolation lives under all of them instead. For `?face=N` (N ≥ 1) this
 * script — the FIRST thing in the player document, ahead of the canvas pin —
 * replaces `window.localStorage` with a facade that suffixes every key with
 * the same `__face<N>` that `faceKey()` defines. No call site changes, and no
 * future call site can forget.
 *
 * ⚠️ FOR FACE 0 IT DOES NOTHING. No `face` param, or `face=0`, returns before
 * touching anything: the entire existing fleet runs byte-identical code paths
 * against the very same Storage object.
 *
 * ⚠️ IT FAILS CLOSED. A `face` param that is present but not 0..MAX, or a
 * platform that refuses the redefinition, must NOT fall through to the shared
 * store — that is the corruption this exists to prevent. The document is
 * stopped and `window.__eduFaceStorage` is set to -1. The native host reads
 * that marker after load and tears the face down unless it equals its own
 * index, so an old cached shell without this script is caught the same way.
 *
 * ES5 ON PURPOSE: it must parse on the oldest WebView that will ever host a
 * face. No arrows, no const/let, no template literals, no Proxy.
 */
import { FACE_PARAM, FACE_SUFFIX, MAX_FACE_INDEX } from './faceStorage';

/** `window.__eduFaceStorage` — N when isolated as face N, -1 when refused. */
export const FACE_STORAGE_MARKER = '__eduFaceStorage';

export const FACE_STORAGE_SHIM = `(function(){
var FAIL=function(){try{window.${FACE_STORAGE_MARKER}=-1;}catch(e){}
try{document.documentElement.setAttribute('data-face-storage','failed');}catch(e){}
try{window.stop();}catch(e){}};
try{
var m=/[?&]${FACE_PARAM}=([^&#]*)/.exec(String(location.search||''));
if(!m)return;
var raw=m[1];
if(!/^[0-9]+$/.test(raw)){FAIL();return;}
var n=parseInt(raw,10);
if(n===0)return;
if(!(n>=1&&n<=${MAX_FACE_INDEX})){FAIL();return;}
var real=window.localStorage;
var sfx='${FACE_SUFFIX}'+n;
var mine=function(k){return String(k)+sfx;};
var owns=function(k){return typeof k==='string'&&k.length>sfx.length&&k.slice(k.length-sfx.length)===sfx;};
var ownKeys=function(){var out=[];for(var i=0;i<real.length;i++){var k=real.key(i);if(owns(k))out.push(k);}return out;};
var facade={
getItem:function(k){return real.getItem(mine(k));},
setItem:function(k,v){real.setItem(mine(k),v);},
removeItem:function(k){real.removeItem(mine(k));},
clear:function(){var dead=ownKeys();for(var i=0;i<dead.length;i++)real.removeItem(dead[i]);},
key:function(i){var ks=ownKeys();var k=ks[i];return typeof k==='string'?k.slice(0,k.length-sfx.length):null;}
};
Object.defineProperty(facade,'length',{get:function(){return ownKeys().length;}});
Object.defineProperty(window,'localStorage',{configurable:true,get:function(){return facade;}});
if(window.localStorage!==facade){FAIL();return;}
window.${FACE_STORAGE_MARKER}=n;
}catch(e){FAIL();}
})();`;
