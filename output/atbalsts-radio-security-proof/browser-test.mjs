// Headless, fresh profile; no screenshots or inspection of the user's browser.
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const playwrightPath=process.env.ATBALSTS_PLAYWRIGHT || '/Users/kristaps/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const {chromium}=await import(playwrightPath);
const root=fileURLToPath(new URL('.',import.meta.url));
const imports={'@hpke/core':'/node_modules/@hpke/core/esm/mod.js','@hpke/common':'/node_modules/@hpke/common/esm/mod.js','@hpke/dhkem-x25519':'/node_modules/@hpke/dhkem-x25519/esm/mod.js','cborg':'/node_modules/cborg/cborg.js'};
const html=`<!doctype html><meta charset="utf-8"><title>Atbalsts protocol test</title><script type="importmap">${JSON.stringify({imports})}</script><script type="module">import * as P from '/protocol.mjs';window.P=P;</script>`;
const server=createServer(async(req,res)=>{
  try {
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1),target=path.resolve(root,rel);
    if(!target.startsWith(root))throw Error('path');
    const b=await fs.readFile(target);res.setHeader('Content-Type',rel.endsWith('.json')?'application/json':'text/javascript');res.end(b);
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.ATBALSTS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const context=await browser.newContext(),page=await context.newPage(),external=[];
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))external.push(r.url());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>!!window.P);
  await context.setOffline(true);
  const result=await page.evaluate(async()=>{
    const P=window.P,ok=(x,m)=>{if(!x)throw Error(m);};
    ok(window.isSecureContext,'secure context');ok(!navigator.onLine,'browser offline');
    const centre=await P.suite().kem.generateKeyPair(),wrong=await P.suite().kem.generateKeyPair();
    const report=[1,1788976800,2,5694960,2410520,'Exercise: shelter entrance blocked'];
    const sealed=await P.sealReport(report,17,centre.publicKey),opened=await P.openReport(sealed,17,centre.privateKey);
    ok(JSON.stringify(opened)===JSON.stringify(report),'browser round trip');
    let refused=false;try{await P.openReport(sealed,17,wrong.privateKey);}catch{refused=true;}ok(refused,'wrong key');
    const key=await crypto.subtle.generateKey('Ed25519',false,['sign','verify']);
    const snap=[1,1,101,1,1,42,1788976800,1788984000,[[100,1,20]],[]];
    const trust=new Map([[P.hex(P.kidBytes(23)),{publicKey:key.publicKey,centre:1,area:101,registry:1,epoch:1,shelterIds:[100]}]]);
    const signed=await P.signSnapshot(snap,23,key.privateKey),state=new P.PublicState(trust);await state.accept(signed,1788976801);
    ok(state.snapshots.get('1/101').data[8][0][2]===20,'public state');
    return {secureContext:isSecureContext,online:navigator.onLine,privateRoundtrip:true,wrongKeyRejected:true,signedPublicState:true,reportBytes:sealed.length};
  });
  assert.equal(external.length,0);result.browser=browser.version();result.externalRequests=external.length;
  if(process.argv.includes('--wireframe')) {
    const fragment='/Users/kristaps/.codex/visualizations/2026/09/09/01a084bd-57c1-7f22-9541-e6d45c7c685c/atbalsts-blackout-wireframe.html';
    const mock=await context.newPage();await mock.setContent(await fs.readFile(fragment,'utf8'));
    await mock.getByRole('button',{name:'Get update',exact:true}).click();
    await mock.getByRole('button',{name:'Start listening',exact:true}).click();
    assert.equal(await mock.locator('#atb-listen-title').textContent(),'Listening…');
    await mock.getByRole('button',{name:'Preview completed reception'}).click();
    assert.equal(await mock.locator('[data-screen="received"]').isVisible(),true);
    await mock.getByRole('button',{name:'View situations and shelters'}).click();
    await mock.getByRole('button',{name:'Report an important observation'}).click();
    await mock.getByRole('button',{name:'Save private report'}).click();
    await mock.getByRole('button',{name:'Send at station'}).click();
    assert.match(await mock.locator('#atb-send-status').textContent(),/unconfirmed/);
    await mock.getByRole('tab',{name:'Centre',exact:true}).click();
    await mock.locator('#atb-public-draft').fill('<b>Literal text</b>');
    await mock.getByRole('button',{name:'Preview public update'}).click();
    assert.equal(await mock.locator('#atb-preview-text').textContent(),'<b>Literal text</b>');
    assert.equal(await mock.locator('#atb-preview-text b').count(),0);
    result.wireframe={navigationPassed:true,deliveryRemainsUnconfirmed:true,previewUsesPlainText:true,screenshotsTaken:0};
    await mock.close();
  }
  result.limitation='Fresh headless desktop Chrome, offline after module load; not an installed PWA cold-start or physical-phone test.';
  await fs.writeFile(new URL('./browser-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
