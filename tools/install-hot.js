/* 外部安装 1.4.52 热运行时：解包 → junction → .ready → 打补丁 → 切 current.json */
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const APP='C:\\Users\\Administrator\\AppData\\Local\\Programs\\Breezell\\resources\\app';
const HR=path.join(process.env.APPDATA,'Breezell','hot-runtime');
const VER='1.4.52';
const SHA='d3ad01a71d7da12d2a1ff30019e97b732175e04be763d56aa77dd1042c2b47ec';
const ZIP=path.join(process.env.APPDATA,'Breezell','hot-cache','breezell-hot-'+VER+'.zip');
const DIR=VER+'-'+SHA.slice(0,12);
const DEST=path.join(HR,DIR);

function sha256File(p){ return new Promise((res,rej)=>{ const h=crypto.createHash('sha256'); const s=fs.createReadStream(p); s.on('data',d=>h.update(d)); s.on('end',()=>res(h.digest('hex'))); s.on('error',rej); }); }

(async()=>{
  if(!fs.existsSync(ZIP)) throw new Error('zip missing '+ZIP);
  const h=await sha256File(ZIP);
  console.log('zip sha256', h, h===SHA?'OK':'MISMATCH');
  if(h!==SHA) throw new Error('sha mismatch');

  // 清理旧目录
  if(fs.existsSync(DEST)){
    console.log('dest exists, removing', DEST);
    try{ fs.rmSync(DEST,{recursive:true,force:true}); }catch(e){ console.log('rm warn', e.message); }
  }
  fs.mkdirSync(DEST,{recursive:true});

  // 解包（yauzl 来自安装目录 node_modules）
  const yauzl=require(path.join(APP,'node_modules','yauzl'));
  let n=0;
  await new Promise((res,rej)=>{
    yauzl.open(ZIP,{lazyEntries:true},(err,zipf)=>{
      if(err) return rej(err);
      zipf.readEntry();
      zipf.on('entry',ent=>{
        const name=ent.fileName;
        if(/\/$/.test(name)){ zipf.readEntry(); return; }
        const out=path.join(DEST, name.split('/').join(path.sep));
        fs.mkdirSync(path.dirname(out),{recursive:true});
        zipf.openReadStream(ent,(e,rs)=>{
          if(e) return rej(e);
          const ws=fs.createWriteStream(out);
          rs.pipe(ws);
          ws.on('close',()=>{ n++; zipf.readEntry(); });
          ws.on('error',rej);
        });
      });
      zipf.on('end',res);
      zipf.on('error',rej);
    });
  });
  console.log('extracted', n, 'entries');

  // junction
  const links=[['extensions',path.join(APP,'extensions')],['node_modules',path.join(APP,'node_modules')],['resources',path.join(APP,'resources')]];
  for(const [name,target] of links){
    const lp=path.join(DEST,name);
    try{ if(fs.existsSync(lp)||fs.lstatSync(lp,{throwIfNoEntry:false})) fs.rmSync(lp,{recursive:true,force:true}); }catch(e){}
    const r=require('child_process').spawnSync('cmd',['/c','mklink','/J',lp,target],{encoding:'utf8'});
    console.log('link', name, r.status===0?'created':'FAIL '+r.stderr);
  }
  fs.writeFileSync(path.join(DEST,'.ready'), new Date().toISOString());
  console.log('ready written');

  // 打补丁
  const P=require('C:/Users/Administrator/Breezell-Work/patch/breezell-offline/pkg/extension/src/appPatcher.js');
  const lines=[];
  const rep=P.patchRoot(DEST, lines);
  const st={}; (rep.results||[]).forEach(x=>st[x.status]=(st[x.status]||0)+1);
  console.log('patch statuses', JSON.stringify(st), 'errors', JSON.stringify(rep.errors||[]));
  console.log('describe', JSON.stringify(P.describeRoot(P.inspectRoot(DEST))));

  // current.json
  const cur=path.join(HR,'current.json');
  let old={}; try{ old=JSON.parse(fs.readFileSync(cur,'utf8')); }catch(e){}
  const next={ version:VER, baseVersion:'1.4.5', dir:DIR, bootAttempts:0,
    failedVersions: old.failedVersions||[], sha256:SHA, previousVersion: old.version||'' };
  fs.writeFileSync(cur+'.tmp', JSON.stringify(next,null,2));
  fs.renameSync(cur+'.tmp', cur);
  console.log('current.json ->', JSON.stringify(next));
})().catch(e=>{ console.log('FAIL', e.message); process.exit(1); });