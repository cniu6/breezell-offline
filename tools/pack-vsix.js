/* 打包 vsix 到 离线破解插件成品\ */
const fs=require('fs'), path=require('path'), zlib=require('zlib'), crypto=require('crypto');
const PKG='C:/Users/Administrator/Breezell-Work/patch/breezell-offline/pkg';
const OUTDIR='C:/Users/Administrator/Breezell-Work/离线破解插件成品';
const ver=JSON.parse(fs.readFileSync(PKG+'/extension/package.json','utf8')).version;
const OUT=path.join(OUTDIR,'breezell-offline-'+ver+'.vsix');
const MIRROR='C:/Users/Administrator/Breezell-Work/patch/breezell-offline/breezell-offline-'+ver+'.vsix';
const table=new Int32Array(256); for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;table[n]=c;}
const crc32=b=>{let c=-1;for(let i=0;i<b.length;i++)c=table[(c^b[i])&0xFF]^(c>>>8);return (c^-1)>>>0;};
const files=[];
function add(abs,rel){ files.push({rel:rel.replace(/\\/g,'/'), data:fs.readFileSync(abs)}); }
add(path.join(PKG,'[Content_Types].xml'),'[Content_Types].xml');
add(path.join(PKG,'extension.vsixmanifest'),'extension.vsixmanifest');
(function walk(d,base){ for(const n of fs.readdirSync(d)){ const p=path.join(d,n); const st=fs.statSync(p); if(st.isDirectory()) walk(p,base); else files.push({rel:'extension/'+path.relative(base,p).replace(/\\/g,'/'), data:fs.readFileSync(p)}); } })(path.join(PKG,'extension'), path.join(PKG,'extension'));
const local=[], central=[]; let off=0;
for(const f of files){
  const crc=crc32(f.data), comp=zlib.deflateRawSync(f.data,{level:9});
  const name=Buffer.from(f.rel,'utf8');
  const lh=Buffer.alloc(30); lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4); lh.writeUInt16LE(0,6); lh.writeUInt16LE(8,8);
  lh.writeUInt16LE(0,10); lh.writeUInt16LE(0,12); lh.writeUInt32LE(crc,14); lh.writeUInt32LE(comp.length,18); lh.writeUInt32LE(f.data.length,22); lh.writeUInt16LE(name.length,26); lh.writeUInt16LE(0,28);
  local.push(lh,name,comp);
  const ch=Buffer.alloc(46); ch.writeUInt32LE(0x02014b50,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6); ch.writeUInt16LE(0,8); ch.writeUInt16LE(8,10);
  ch.writeUInt16LE(0,12); ch.writeUInt16LE(0,14); ch.writeUInt32LE(crc,16); ch.writeUInt32LE(comp.length,20); ch.writeUInt32LE(f.data.length,24);
  ch.writeUInt16LE(name.length,28); ch.writeUInt16LE(0,30); ch.writeUInt16LE(0,32); ch.writeUInt16LE(0,34); ch.writeUInt16LE(0,36);
  ch.writeUInt32LE(0,38); ch.writeUInt32LE(off,42);
  central.push(ch,name);
  off += 30+name.length+comp.length;
}
const cd=Buffer.concat(central);
const eocd=Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(0,4); eocd.writeUInt16LE(0,6);
eocd.writeUInt16LE(files.length,8); eocd.writeUInt16LE(files.length,10); eocd.writeUInt32LE(cd.length,12); eocd.writeUInt32LE(off,16); eocd.writeUInt16LE(0,20);
const buf=Buffer.concat([...local,cd,eocd]);
fs.mkdirSync(OUTDIR,{recursive:true});
fs.writeFileSync(OUT,buf); try{ fs.writeFileSync(MIRROR,buf);}catch(e){}
console.log('built',OUT,buf.length,'B entries',files.length,'sha256',crypto.createHash('sha256').update(buf).digest('hex'));