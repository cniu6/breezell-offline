/* 给 Seti 图标主题补常见映射（Breezell 内建 theme-seti 未覆盖的扩展名/文件名）
   用法: node theme-augment.js [--dry]
   重装 Breezell 后需要重新执行一次。 */
const fs = require('fs');
const P = 'C:/Users/Administrator/AppData/Local/Programs/Breezell/resources/app/extensions/theme-seti/icons/vs-seti-icon-theme.json';
const dry = process.argv.includes('--dry');
const j = JSON.parse(fs.readFileSync(P, 'utf8'));
const fe = j.fileExtensions || (j.fileExtensions = {});
const fn = j.fileNames || (j.fileNames = {});

const EXT = {
  // 文本 / 日志
  txt: '_info', log: '_info', out: '_info', err: '_info', trace: '_info',
  // 数据库
  db: '_db_1', sqlite: '_db_1', sqlite3: '_db_1', 'db-shm': '_db_1', 'db-wal': '_db_1', 'db-journal': '_db_1',
  // 脚本
  sh: '_shell', bash: '_shell', zsh: '_shell', ksh: '_shell', fish: '_shell',
  ps1: '_powershell', psm1: '_powershell', psd1: '_powershell',
  bat: '_windows', cmd: '_windows',
  // 配置
  ini: '_config', conf: '_config', cfg: '_config', properties: '_config', editorconfig: '_config',
  reg: '_config', plist: '_config', xaml: '_xml',
  // 锁 / 校验
  lock: '_lock', sum: '_lock', mod: '_lock', 'lock.json': '_lock',
  // 压缩 / 镜像
  tar: '_zip', gz: '_zip', tgz: '_zip', bz2: '_zip', xz: '_zip', '7z': '_zip_1', rar: '_zip_1', iso: '_zip',
  // 二进制
  exe: '_windows', dll: '_windows', sys: '_windows', so: '_wasm', dylib: '_wasm', pdb: '_windows',
  apk: '_android' in j.iconDefinitions ? '_android' : '_zip_1',
  // 表格 / 文档
  tsv: '_csv', xls: '_xls', xlsm: '_xls', ppt: '_word', pptx: '_word', rtf: '_word', odt: '_word',
  // 其它常见
  manifest: '_config', envrc: '_config', gitignore: '_git', gitattributes: '_git',
  mdx: '_markdown', rst: '_markdown', adoc: '_markdown',
  http: '_http' in j.iconDefinitions ? '_http' : '_config'
};

const NAME = {
  dockerfile: '_docker', 'docker-compose.yml': '_docker', 'docker-compose.yaml': '_docker',
  'go.mod': '_go2', 'go.sum': '_lock', 'go.work': '_go2',
  'makefile': '_makefile', 'cmakelists.txt': '_config',
  '.gitignore': '_git', '.gitattributes': '_git', '.gitmodules': '_git',
  '.npmrc': '_npm', '.npmignore': '_npm_ignored', '.nvmrc': '_config',
  '.env': '_config', '.env.local': '_config', '.env.example': '_config',
  'cargo.toml': '_rust', 'cargo.lock': '_lock',
  'package-lock.json': '_npm', 'yarn.lock': '_yarn', 'pnpm-lock.yaml': '_lock',
  'requirements.txt': '_python', 'pipfile': '_python', 'pyproject.toml': '_python',
  'tsconfig.json': '_tsconfig', 'vite.config.ts': '_vite', 'webpack.config.js': '_webpack',
  'license': '_license', 'license.txt': '_license', 'notice': '_license'
};

const defs = j.iconDefinitions || {};
let added = 0, skipped = 0, unknown = [];
for (const [k, v] of Object.entries(EXT)) {
  if (!defs[v]) { unknown.push(k + '->' + v); continue; }
  if (fe[k] === v) { skipped++; continue; }
  fe[k] = v; added++;
}
for (const [k, v] of Object.entries(NAME)) {
  if (!defs[v]) { unknown.push(k + '->' + v); continue; }
  if (fn[k] === v) { skipped++; continue; }
  fn[k] = v; added++;
}
console.log('added=' + added + ' skipped=' + skipped + ' unknownDef=' + JSON.stringify(unknown));
if (dry) { console.log('dry run, not written'); process.exit(0); }
if (!fs.existsSync(P + '.bak')) fs.copyFileSync(P, P + '.bak');
fs.writeFileSync(P, JSON.stringify(j, null, 2), 'utf8');
console.log('written', P, fs.statSync(P).size, 'B');