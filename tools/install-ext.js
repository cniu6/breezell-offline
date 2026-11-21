/* 安装扩展到 .breezell-editor\extensions（版本自 package.json 读取，自动清理旧版本） */
const fs=require('fs'), path=require('path');
const SRC='C:/Users/Administrator/Breezell-Work/patch/breezell-offline/pkg/extension';
const EXT_ROOT=path.join(process.env.USERPROFILE,'.breezell-editor','extensions');
const ver=JSON.parse(fs.readFileSync(SRC+'/package.json','utf8')).version;
const DEST=path.join(EXT_ROOT,'local.breezell-offline-'+ver);
function walk(d,base=d,out=[]){ for(const n of fs.readdirSync(d)){ const p=path.join(d,n), r=path.relative(base,p); const st=fs.statSync(p); if(st.isDirectory()) walk(p,base,out); else out.push([r,st.size]); } return out; }
// 清旧版本
for(const n of fs.readdirSync(EXT_ROOT)){
  if(/^local\.breezell-offline-/.test(n) && n!=='local.breezell-offline-'+ver){
    fs.rmSync(path.join(EXT_ROOT,n),{recursive:true,force:true}); console.log('removed old',n);
  }
}
fs.rmSync(DEST,{recursive:true,force:true});
fs.mkdirSync(DEST,{recursive:true});
for(const [rel] of walk(SRC)){ const s=path.join(SRC,rel), d=path.join(DEST,rel); fs.mkdirSync(path.dirname(d),{recursive:true}); fs.copyFileSync(s,d); }
const files=walk(DEST);
console.log('installed',DEST,'files',files.length,'bytes',files.reduce((a,b)=>a+b[1],0));
// 更新 extensions.json
const EJ=path.join(EXT_ROOT,'extensions.json');
const list=JSON.parse(fs.readFileSync(EJ,'utf8').replace(/^\uFEFF/,''));
let hit=0;
for(const e of list){ if(e && e.identifier && e.identifier.id==='local.breezell-offline'){
  hit++;
  e.version=ver;
  e.location={ $mid:1, fsPath:DEST, path:DEST, scheme:'file' };
  e.relativeLocation='local.breezell-offline-'+ver;
  e.metadata={ installedTimestamp:Date.now(), source:'vsix', isPreReleaseVersion:false, hasPreReleaseVersion:false, targetPlatform:'undefined' };
}}
fs.writeFileSync(EJ,JSON.stringify(list),'utf8');
console.log('extensions.json entries',list.length,'nulls',list.filter(x=>!x).length,'ours hit',hit,'version',ver);