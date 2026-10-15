// Run: node prototypes/tokophi-account/check-local.mjs
// Existing Playwright + installed Chrome; fixture server only, no external requests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const serverPath = fileURLToPath(new URL('./dev-server.mjs', import.meta.url));
const server = spawn(process.execPath, [serverPath], { env: { ...process.env, PORT: '0' }, stdio: ['ignore','pipe','pipe'] });
let browser;
let failures = 0;
let passed = 0;
const screenshots = process.env.ACCOUNT_SCREENSHOTS;
try {
  const origin = await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Local server start timed out')),10000);
    server.once('error',error=>{clearTimeout(timer);reject(error)});
    server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}`))});
    server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  });
  browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome',args:['--no-sandbox']});
  async function check(name,run) {
    const context=await browser.newContext({viewport:{width:390,height:900}});
    const page=await context.newPage();page.setDefaultTimeout(4000);
    const errors=[]; const outbound=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin!==origin){outbound.push(route.request().url());return route.abort();}
      return route.continue();
    });
    async function login(path='/orders') {
      await page.goto(origin+path);
      await page.locator('#login-phone').fill('81234567890');
      await page.locator('#phone-form button[type=submit]').click();
      await page.locator('#login-otp').fill('123456');
      await page.locator('#verify-button').click();
    }
    try {await run(page,login,origin);assert.deepEqual(errors,[],'No browser exceptions');assert.deepEqual(outbound,[],'No outbound requests');passed++;console.log(`PASS ${name}`);}
    catch(error){failures++;console.error(`FAIL ${name}: ${error.stack}`);}
    finally {await context.close();}
  }
  const heading=async page=>page.locator('#content h1').innerText();
  const submit=page=>page.locator('#flow-dialog button[type=submit]').click();
  const closed=page=>page.locator('#flow-dialog').waitFor({state:'hidden'});
  await check('list/detail/back, filter persistence and canonical account navigation',async(page,login)=>{
    await login();assert.equal(await heading(page),'Pesanan Anda');
    await page.getByRole('button',{name:'Retur',exact:true}).click();
    assert.equal(await page.locator('.order-card').count(),1);
    await page.locator('.order-card').click();assert.equal(await heading(page),'Pengembalian barang diproses');
    await page.getByRole('link',{name:'Kembali ke pesanan'}).click();assert.equal(await page.locator('.order-card').count(),1);
    await page.locator('.mobile-nav [data-route=profile]').click();assert.match(page.url(),/\/account$/);assert.equal(await heading(page),'Profil & keamanan');
    await page.reload();assert.equal(await heading(page),'Profil & keamanan');
  });
  await check('search plus store filter and no-results recovery',async(page,login)=>{
    await login();await page.getByLabel('Cari pesanan',{exact:true}).fill('keyboard');await page.getByLabel('Toko',{exact:true}).selectOption('techready');await page.getByRole('button',{name:'Cari',exact:true}).click();assert.equal(await page.locator('.order-card').count(),2);
    await page.getByLabel('Cari pesanan',{exact:true}).fill('not-a-product');await page.getByRole('button',{name:'Cari',exact:true}).click();assert.equal(await page.locator('.order-card').count(),0);await page.getByRole('link',{name:'Hapus filter'}).click();assert.equal(await page.locator('.order-card').count(),6);
  });
  await check('empty/error/retry and unknown-order never show another order',async(page,login,origin)=>{
    await login('/orders?scenario=empty');assert.equal(await page.locator('.order-card').count(),0);assert.equal(await page.getByRole('button',{name:'Cari pesanan saya'}).count(),1);
    await page.goto(origin+'/orders/UNKNOWN');assert.equal(await heading(page),'Data ini tidak tersedia');assert.equal(await page.locator('.line-item').count(),0);
    await page.goto(origin+'/orders?scenario=error');await page.getByRole('button',{name:'Coba lagi'}).click();assert.equal(await page.locator('.order-card').count(),6);
  });
  await check('profile failed save retains values, retry persists, dialog Escape restores focus',async(page,login)=>{
    await login('/account?save=error');const edit=page.getByRole('button',{name:'Edit profil'});await edit.click();await page.keyboard.press('Escape');assert.equal(await edit.evaluate(el=>el===document.activeElement),true);
    await edit.click();await page.getByLabel('Nama',{exact:true}).fill('Sari Contoh');await submit(page);await page.locator('#flow-error').waitFor({state:'visible'});assert.equal(await page.getByLabel('Nama',{exact:true}).inputValue(),'Sari Contoh');await submit(page);await closed(page);await page.reload();assert.match(await page.locator('#content').innerText(),/Sari Contoh/);
  });
  await check('address add/edit/default/delete and snapshot preservation',async(page,login,origin)=>{
    await login('/addresses');await page.getByRole('button',{name:'Tambah alamat'}).click();
    await page.getByLabel('Label alamat').fill('Gudang contoh');await page.getByLabel('Alamat lengkap').fill('Jalan Contoh Nomor 123');await page.getByLabel('Kecamatan',{exact:true}).selectOption('3171090');await page.getByLabel('Kode pos').fill('12820');await page.getByLabel('Jadikan alamat utama').check();await submit(page);await closed(page);
    assert.equal(await page.locator('.address-card').count(),3);const card=page.locator('.address-card').filter({hasText:'Gudang contoh'});assert.match(await card.innerText(),/Utama/);
    await card.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Alamat lengkap').fill('Jalan Alamat Baru Nomor 456');await submit(page);await closed(page);await page.reload();assert.match(await page.locator('#content').innerText(),/Jalan Alamat Baru/);
    await page.goto(origin+'/orders/PHI-202951778F2Y');assert.match(await page.locator('#content').innerText(),/Tebet Timur Dalam/);assert.doesNotMatch(await page.locator('#content').innerText(),/Jalan Alamat Baru/);
    await page.goto(origin+'/addresses');await page.locator('.address-card').filter({hasText:'Gudang contoh'}).getByRole('button',{name:'Hapus',exact:true}).click();await page.getByRole('button',{name:'Batal',exact:true}).click();assert.equal(await page.locator('.address-card').count(),3);
    await page.locator('.address-card').filter({hasText:'Gudang contoh'}).getByRole('button',{name:'Hapus',exact:true}).click();await submit(page);await closed(page);assert.equal(await page.locator('.address-card').count(),2);assert.equal(await page.locator('.address-card .badge').count(),1);
  });
  await check('payment simulation updates same order; expired payment cannot be submitted',async(page,login,origin)=>{
    await login('/orders/PHI-202865413Q8M/payment?payment=expired');assert.equal(await page.getByRole('button',{name:'Simulasikan pembayaran'}).count(),0);
    await page.goto(origin+'/orders/PHI-202865413Q8M/payment?payment=delayed');assert.match(await page.locator('#content').innerText(),/Jangan membayar lagi/);await page.getByRole('button',{name:'Cek ulang status demo'}).click();await submit(page);await closed(page);assert.equal(await heading(page),'Pembayaran diterima');
    await page.goto(origin+'/orders');assert.equal(await page.locator('.order-card').count(),6);await page.getByRole('button',{name:'Belum bayar',exact:true}).click();assert.equal(await page.locator('.order-card').count(),0);
  });
  await check('help request stays tied to order and pending review after reload',async(page,login)=>{
    await login('/orders/PHI-202951778F2Y/help');await page.getByRole('button',{name:'Ajukan bantuan'}).click();await page.getByLabel('Jenis masalah').selectOption('Pengiriman');await page.getByLabel('Ceritakan masalahnya').fill('Paket contoh belum diterima di alamat.');await submit(page);await closed(page);await page.reload();assert.match(await page.locator('#content').innerText(),/Paket contoh belum diterima/);assert.match(await page.locator('#content').innerText(),/Menunggu peninjauan/);
  });
  await check('claim rejects wrong proof, consent links once, repeat does not duplicate',async(page,login,origin)=>{
    await login();await page.getByRole('button',{name:'Cari pesanan saya'}).click();await page.getByLabel('Nomor pesanan',{exact:true}).fill('DEMO-GUEST-001');await page.getByLabel('Kode bukti pesanan').fill('WRONG');await page.locator('#flow-dialog input[type=checkbox]').check();await submit(page);await page.locator('#flow-error').waitFor({state:'visible'});await page.getByLabel('Kode bukti pesanan').fill('CLAIM-246810');await submit(page);await closed(page);assert.match(page.url(),/DEMO-GUEST-001/);
    await page.goto(origin+'/orders');assert.equal(await page.locator('.order-card').count(),7);await page.getByRole('button',{name:'Cari pesanan saya'}).click();await page.getByLabel('Nomor pesanan',{exact:true}).fill('DEMO-GUEST-001');await page.getByLabel('Kode bukti pesanan').fill('CLAIM-246810');await page.locator('#flow-dialog input[type=checkbox]').check();await submit(page);await closed(page);await page.goto(origin+'/orders');assert.equal(await page.locator('.order-card').count(),7);
  });
  await check('phone verification, revoke, disconnect/reconnect and preference persistence',async(page,login)=>{
    await login('/account');await page.getByRole('button',{name:'Ubah nomor HP',exact:true}).click();await page.getByLabel('Nomor HP baru').fill('081299998888');await page.getByLabel('Kode verifikasi demo').fill('111111');await submit(page);await page.locator('#flow-error').waitFor({state:'visible'});await page.getByLabel('Kode verifikasi demo').fill('123456');await submit(page);await closed(page);
    await page.getByRole('button',{name:'Keluar dari perangkat lain',exact:true}).click();await submit(page);await closed(page);assert.match(await page.locator('#content').innerText(),/Tidak ada perangkat lain/);
    await page.getByRole('button',{name:'Putuskan',exact:true}).first().click();await submit(page);await closed(page);assert.equal(await page.getByRole('button',{name:'Hubungkan',exact:true}).count(),1);
    await page.getByRole('button',{name:'Hubungkan',exact:true}).click();await page.locator('#flow-dialog input[type=checkbox]').check();await submit(page);await closed(page);
    await page.getByLabel('Promo dari toko terhubung',{exact:true}).check();await page.reload();assert.equal(await page.getByLabel('Promo dari toko terhubung',{exact:true}).isChecked(),true);
    await page.getByRole('button',{name:'Keluar dari akun',exact:true}).click();assert.equal(await page.locator('#login-shell').isVisible(),true);await page.reload();assert.equal(await page.locator('#buyer-shell').isVisible(),false);
  });
  await check('OTP expiry/resend and recovery request does not sign in',async(page,login,origin)=>{
    await login('/orders?otp=expired');assert.match(await page.locator('#otp-error').innerText(),/kedaluwarsa/);await page.locator('#resend-otp').click();await page.locator('#login-otp').fill('123456');await page.locator('#verify-button').click();assert.equal(await heading(page),'Pesanan Anda');
    await page.goto(origin+'/account');await page.getByRole('button',{name:'Keluar dari akun',exact:true}).click();await page.getByRole('button',{name:'Nomor lama tidak bisa diakses?'}).click();await page.getByLabel('Nomor lama',{exact:true}).fill('081234567890');await page.getByLabel('Email untuk tindak lanjut').fill('demo@example.test');await page.getByLabel('Keterangan',{exact:true}).fill('Nomor contoh tidak dapat diakses lagi.');await submit(page);await closed(page);assert.equal(await page.locator('#buyer-shell').isVisible(),false);
  });
  await check('zero-address guest checkout and hostile profile text stays inert',async(page,login,origin)=>{
    await login('/addresses');for(let i=0;i<2;i++){await page.getByRole('button',{name:'Hapus',exact:true}).first().click();await submit(page);await closed(page);}
    await page.goto(origin+'/checkout');assert.equal(await page.locator('#guest-name').isVisible(),true);
    await page.goto(origin+'/account');await page.getByRole('button',{name:'Edit profil'}).click();await page.getByLabel('Nama',{exact:true}).fill('<img src=x onerror=alert(1)>');await submit(page);await closed(page);assert.equal(await page.locator('#content img').count(),0);
  });
  await check('guest checkout stays available without login and preserves input through sign-in',async(page,login,origin)=>{
    await page.goto(origin+'/');await page.getByRole('link',{name:'Coba checkout tanpa akun'}).click();
    await page.locator('#guest-name').fill('Tamu Contoh');await page.locator('#guest-name').blur();
    await page.getByRole('button',{name:'Masuk untuk memakai alamat akun'}).click();
    await page.locator('#login-phone').fill('81234567890');await page.locator('#phone-form button[type=submit]').click();await page.locator('#login-otp').fill('123456');await page.locator('#verify-button').click();
    assert.equal(await page.locator('#guest-name').inputValue(),'Tamu Contoh');
    await page.getByRole('button',{name:'Gunakan alamat akun',exact:true}).click();assert.equal(await page.locator('#switch-guest-mode').isVisible(),true);
  });
  await check('guest address edits invalidate the quote before any simulated order',async(page,login,origin)=>{
    await page.goto(origin+'/checkout?guest=1');
    for(const [id,value] of [['name','Tamu Contoh'],['phone','081234567890'],['address','Jalan Contoh Nomor 123'],['postcode','12820']])await page.locator('#guest-'+id).fill(value);
    await page.locator('#guest-destId').selectOption('3171090');await page.getByRole('button',{name:'Tinjau alamat dan ongkir'}).click();
    await page.locator('#shipping-standard').check();await page.locator('#payment-QRIS').check();assert.equal(await page.locator('#place-demo-order').isEnabled(),true);
    await page.locator('#guest-address').fill('Jalan Berubah Nomor 456');assert.equal(await page.locator('#place-demo-order').isDisabled(),true);
    await page.getByRole('button',{name:'Tinjau alamat dan ongkir'}).click();await page.locator('#shipping-standard').check();await page.locator('#payment-QRIS').check();await page.locator('#place-demo-order').click();assert.match(await page.locator('#content').innerText(),/Simulasi selesai/);
  });
  await check('editable address text stays inert in checkout and COD restrictions stay conditional',async(page,login,origin)=>{
    await login('/addresses');await page.locator('.address-card').first().getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Alamat lengkap').fill('<img src=x onerror=alert(1)> Jalan Contoh');await submit(page);await closed(page);
    await page.goto(origin+'/checkout');assert.equal(await page.locator('img[src=x]').count(),0);assert.match(await page.locator('#content').innerText(),/img src=x/);assert.equal(await page.locator('#payment-cod').isEnabled(),true);
    await page.goto(origin+'/checkout?cod=restricted');assert.equal(await page.locator('#payment-cod').isDisabled(),true);
    await page.goto(origin+'/account?cod=restricted');await page.getByText('Status akses COD',{exact:true}).first().click();await page.getByRole('button',{name:'Ajukan peninjauan'}).click();await page.getByLabel('Keterangan',{exact:true}).fill('Catatan contoh perlu ditinjau kembali.');await submit(page);await closed(page);assert.match(await page.locator('#content').innerText(),/Peninjauan akses COD/);
  });
  await check('Buyer account design contract: Geist, final brand token, sidebar 256, header 64, centered 1200px container',async(page,login,origin)=>{
    await page.setViewportSize({width:1280,height:900});await login('/orders');await page.evaluate(()=>document.fonts.ready);
    const shape=await page.evaluate(()=>({
      font:getComputedStyle(document.body).fontFamily,
      loaded:document.fonts.check('14px Geist'),
      sidebar:Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
      header:Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
      shellWidth:Math.round(document.querySelector('.app-shell').getBoundingClientRect().width),
      shellLeft:Math.round(document.querySelector('.app-shell').getBoundingClientRect().left),
      primary:getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      padding:getComputedStyle(document.querySelector('#content')).paddingLeft
    }));
    assert.match(shape.font,/Geist/);assert.equal(shape.loaded,true);assert.equal(shape.sidebar,256);assert.equal(shape.header,64);assert.equal(shape.shellWidth,1200);assert.equal(shape.shellLeft,40);assert.equal(shape.padding,'24px');assert.equal(shape.primary,'oklch(0.515 0.23 277)');
    const activeColors=await page.evaluate(()=>{
      const source=document.createElement('div');source.style.background='color-mix(in oklab, oklch(0.515 0.23 277) 10%, transparent)';document.body.append(source);
      const expected=getComputedStyle(source).backgroundColor;source.remove();
      return {expected,actual:getComputedStyle(document.querySelector('.sidebar .nav-item.is-active')).backgroundColor};
    });assert.equal(activeColors.actual,activeColors.expected,'Active nav must retain Seller indigo alpha, without hue shift');
    await page.goto(origin+'/account');assert.ok((await page.locator('.section-card h2').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).fontSize))).every(size=>size==='16px'));
    await page.setViewportSize({width:1920,height:1080});
    const shell1920=await page.locator('.app-shell').boundingBox();assert.equal(Math.round(shell1920.width),1200);assert.equal(Math.round(shell1920.x),360,'App shell centered with max-width 1200 on 1920px screen');
    const capped=await page.locator('#content').boundingBox();assert.ok(capped.width<=1200);assert.equal(Math.round(capped.x),616,'Content beside the 256px sidebar in centered shell');
  });
  await check('responsive render and keyboard dialog focus containment',async(page,login,origin)=>{
    await login('/orders');if(screenshots)await mkdir(screenshots,{recursive:true});
    for(const width of [320,390,1280,1920]){
      await page.setViewportSize({width,height:900});
      for(const path of ['/orders','/orders/PHI-202951778F2Y','/account','/addresses','/stores','/checkout?guest=1']){
        await page.goto(origin+path);assert.ok(await page.locator('#buyer-shell').isVisible());
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.ok(overflow<=1,`${path} at ${width}: overflow ${overflow}`);
        if(screenshots)await page.screenshot({path:`${screenshots}/${width}-${path.slice(1).replaceAll('/','-').replaceAll('?','-')}.png`,fullPage:true});
      }
    }
    await page.goto(origin+'/addresses');await page.setViewportSize({width:320,height:900});await page.getByRole('button',{name:'Tambah alamat'}).click();if(screenshots)await page.screenshot({path:`${screenshots}/320-address-dialog.png`});assert.ok(await page.locator('#flow-dialog').evaluate(el=>el.scrollWidth-el.clientWidth)<=1);for(let i=0;i<15;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.body || document.activeElement.closest('dialog')!==null),true,'Tab must never focus background content; native dialogs can cycle through browser chrome');}
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Tambah alamat'}).evaluate(el=>el===document.activeElement),true);
  });
} finally {
  await browser?.close();
  server.kill('SIGTERM');if(server.exitCode===null)await once(server,'exit');
}
console.log(`${passed} passed; ${failures} failed`);
process.exitCode=failures?1:0;
