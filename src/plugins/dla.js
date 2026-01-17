import { parentPort } from 'worker_threads';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ABMetaInfo = () => {};
ABMetaInfo({
  pattern: 'dla ?(.*)',
  url: '',
  sudo: false,
  desc: 'Descarga videos y audios con yt-dlp y aria2c',
  type: 'utilidad',
  deps: ['']
});

const C = {
  D: path.join(__dirname, '..', '..', 'Extras', 'DatosPlugins', 'DLA'),
  M: path.join(__dirname, '..', 'media'),
  K: path.join(__dirname, '..', '..', 'Extras', 'DatosPlugins', 'DLA', 'cookies.txt'),
  S: parseInt(process.env.MEDIA_FILE_MAX || '500') * 1048576,
  T: 600000,
  B: new Map([
    ['win32-x64', 'yt-dlp.exe'],
    ['win32-ia32', 'yt-dlp_x86.exe'],
    ['darwin', 'yt-dlp_macos'],
    ['linux-x64', 'yt-dlp_linux'],
    ['linux-arm64', 'yt-dlp_linux_aarch64'],
    ['linux-arm', 'yt-dlp_linux_armv7l'],
    ['default', 'yt-dlp']
  ]),
  F: {
    video: ['-f', 'sd/18/bestvideo[height<=720][vcodec*=h264]+bestaudio[acodec*=aac]/bestvideo[height<=720]+bestaudio/best', '--sponsorblock-remove', 'all', '--embed-chapters', '--embed-metadata'],
    audio: ['-f', 'ba/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-metadata', '--convert-thumbnails', 'jpg', '--sponsorblock-remove', 'all']
  },
  A: ['--restrict-filenames', '--extractor-retries', '3', '--fragment-retries', '3', '--compat-options', 'no-youtube-unavailable-videos', '--ignore-errors', '--no-abort-on-error'],
  R: ['--external-downloader', 'aria2c', '--external-downloader-args', 'aria2c:-x 16 -k 1M -j 16 --file-allocation=none --async-dns=false --max-tries=5 --retry-wait=3']
};

let B = null;

function l(m) {
  parentPort.postMessage({ type: 'log', message: m });
}

function r(o, t, a = null) {
  parentPort.postMessage({
    type: 'response',
    originalMessage: o,
    response: { text: t, attachments: a }
  });
}

async function ensDir() {
  await fs.mkdir(C.D, { recursive: true });
  await fs.mkdir(C.M, { recursive: true });
}

async function isYt() {
  try {
    await execFileAsync('yt-dlp', ['--version']);
    return true;
  } catch { return false; }
}

function detBin() {
  const k = `${os.platform()}-${os.arch()}`;
  return C.B.get(k) || C.B.get('default');
}

async function dlBin() {
  const n = detBin();
  const u = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${n}`;
  const p = path.join(C.D, n);
  
  l('⬇️ Descargando yt-dlp...');
  
  const f = (await import('node-fetch')).default;
  const res = await f(u);
  
  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
  
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(p, buf);
  
  if (os.platform() !== 'win32') await fs.chmod(p, '755');
  
  l('✅ yt-dlp descargado');
  return p;
}

async function getBin() {
  if (B) return B;
  if (await isYt()) {
    B = 'yt-dlp';
    return B;
  }
  
  const n = detBin();
  const p = path.join(C.D, n);
  
  try {
    await fs.access(p);
    B = p;
    return B;
  } catch {
    B = await dlBin();
    return B;
  }
}

function bCook() {
  try {
    require('fs').accessSync(C.K, require('fs').constants.F_OK);
    return ['--cookies', C.K];
  } catch { return []; }
}

function nTime(s) {
  const p = s.split(':');
  if (p.length === 2) {
    const [m, sec] = p;
    return `00:${m.padStart(2, '0')}:${sec.padStart(2, '0')}`;
  } else if (p.length === 3) {
    const [h, m, sec] = p;
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${sec.padStart(2, '0')}`;
  }
  return s;
}

function pTime(t) {
  if (!t || !t.trim()) return null;
  
  const r = t.split(/\s+|,/).filter(x => x.trim());
  const n = [];
  
  for (const rg of r) {
    if (rg.includes('-')) {
      const [st, en] = rg.split('-');
      n.push(`*${nTime(st.trim())}-${nTime(en.trim())}`);
    }
  }
  
  return n.length > 0 ? n.join(',') : null;
}

function getCat(p) {
  const e = path.extname(p).slice(1).toLowerCase();
  const v = ['mp4', 'mkv', 'avi', 'webm', 'mov', 'flv', 'm4v'];
  const a = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'];
  const i = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
  
  if (v.includes(e)) return 'video';
  if (a.includes(e)) return 'audio';
  if (i.includes(e)) return 'image';
  return 'document';
}

function getMime(p) {
  const e = path.extname(p).slice(1).toLowerCase();
  const m = {
    'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'webm': 'video/webm',
    'mp3': 'audio/mpeg', 'ogg': 'audio/ogg', 'm4a': 'audio/mp4',
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif'
  };
  return m[e] || 'application/octet-stream';
}

async function exec(args) {
  const bin = await getBin();
  return await execFileAsync(bin, args, { maxBuffer: 1024 * 1024 * 100, timeout: C.T });
}

function isUrl(s) {
  try { new URL(s); return true; } catch { return false; }
}

async function chkZip() {
  try {
    await execFileAsync('which', ['zip']);
    return true;
  } catch { return false; }
}

async function zipFiles(d) {
  const o = path.join(C.M, `pl_${Date.now()}.zip`);
  const f = await fs.readdir(d);
  await execFileAsync('zip', ['-r', o, ...f], { cwd: d, maxBuffer: 1024 * 1024 * 100 });
  return o;
}

async function loadInfo(d) {
  const f = await fs.readdir(d);
  const j = f.filter(x => x.endsWith('.info.json'));
  const m = new Map();
  let g = null;
  
  for (const jf of j) {
    try {
      const c = await fs.readFile(path.join(d, jf), 'utf8');
      const data = JSON.parse(c);
      const base = jf.replace('.info.json', '');
      const media = f.filter(x => {
        const fb = x.substring(0, x.lastIndexOf('.'));
        return fb === base && !x.endsWith('.info.json');
      });
      
      if (media.length > 0) {
        for (const mf of media) {
          m.set(mf, { title: data.title || '', desc: data.description || '', up: data.uploader || '' });
        }
      } else if (!g) {
        g = { title: data.title || '', desc: data.description || '', up: data.uploader || '' };
      }
    } catch { continue; }
  }
  
  return { m, g };
}

function fmtCap(i) {
  if (!i) return null;
  const t = i.up ? `> ${i.title} - ${i.up}` : i.title;
  const d = i.desc ? `${i.desc}` : '';
  return d ? `${t}\n${d}` : t;
}

async function fixExt(p) {
  const e = path.extname(p).slice(1).toLowerCase();
  const known = ['mp4', 'mkv', 'webm', 'mp3', 'ogg', 'm4a', 'jpg', 'png', 'gif'];
  if (known.includes(e)) return p;
  
  try {
    const { stdout } = await execFileAsync('file', ['-b', '--extension', p]);
    const det = stdout.trim().split('/')[0];
    if (det && det !== '???') {
      const np = e ? p.replace(/\.[^.]*$/, `.${det}`) : `${p}.${det}`;
      await fs.rename(p, np);
      return np;
    }
  } catch {}
  return p;
}

async function clean(t) {
  try {
    const s = await fs.stat(t);
    if (s.isDirectory()) {
      await fs.rm(t, { recursive: true, force: true });
    } else {
      await fs.unlink(t);
    }
  } catch {}
}

async function updt() {
  try {
    const res = await exec(['--update-to', 'master']);
    return `🔄 ${res.stdout || res.stderr || 'Actualizado'}`;
  } catch { return null; }
}

async function dlMedia(msg, urls, fmt = 'video', pl = false, time = null) {
  const sid = `dla_${Date.now()}`;
  const od = path.join(C.M, sid);
  const ck = bCook();
  
  await fs.mkdir(od, { recursive: true });
  
  r(msg, '⏳ Descargando...');
  
  const isMp3Pl = fmt === 'audio' && pl;
  const isDirect = fmt === 'video' && !pl;
  let err = null;
  
  for (const u of urls) {
    const ot = path.join(od, '%(title).70s.%(ext)s');
    const pla = pl ? ['--yes-playlist', '--playlist-items', '1:20'] : ['--no-playlist'];
    const tra = time && !pl ? ['--download-sections', time] : [];
    const ija = isDirect ? ['--write-info-json'] : [];
    
    const args = ['--max-filesize', C.S.toString(), ...C.A, ...pla, ...ck, ...tra, ...ija, ...C.F[fmt], '-o', ot, u];
    
    try {
      await exec(args);
    } catch (e) {
      err = e;
    }
  }
  
  let af = await fs.readdir(od);
  let fls = af.filter(x => !x.endsWith('.info.json'));
  
  if (fls.length === 0 && isDirect) {
    for (const u of urls) {
      const ot = path.join(od, '%(title).70s.%(ext)s');
      const tra = time ? ['--download-sections', time] : [];
      const args = ['--max-filesize', C.S.toString(), ...C.A, ...C.R, ['--no-playlist'], ...ck, ...tra, ...C.F[fmt], '-o', ot, u];
      
      try {
        await exec(args);
      } catch (e) {
        err = e;
      }
    }
    
    af = await fs.readdir(od);
    fls = af.filter(x => !x.endsWith('.info.json'));
  }
  
  if (fls.length === 0) {
    await clean(od);
    const em = err ? err.stderr || err.message || 'Error' : 'Sin archivos';
    const um = await updt();
    r(msg, um ? `${em}\n\n${um}` : em);
    return;
  }
  
  let im = new Map();
  let gi = null;
  
  if (isDirect) {
    const { m, g } = await loadInfo(od);
    im = m;
    gi = g;
  }
  
  if (isMp3Pl && fls.length > 1 && await chkZip()) {
    try {
      const zp = await zipFiles(od);
      const atts = [{
        type: 'document',
        fileUrl: null,
        filePath: zp,
        filename: path.basename(zp),
        mimeType: 'application/zip',
        size: null, width: null, height: null, duration: null,
        caption: 'Usa 7zip'
      }];
      r(msg, '✅ Playlist ZIP', atts);
      await clean(zp);
      await clean(od);
      return;
    } catch {}
  }
  
const atts = [];
let mainCaption = `✅ ${fls.length} archivo(s)`;

for (let i = 0; i < fls.length; i++) {
  const f = fls[i];
  const fp = await fixExt(path.join(od, f));
  const cat = getCat(fp);
  const mime = getMime(fp);
  let cap = null;
  
  if (isDirect && fls.length === 1) {
    // Un solo archivo: poner info en caption del mensaje
    if (im.has(f)) {
      mainCaption = fmtCap(im.get(f));
    } else if (gi) {
      mainCaption = fmtCap(gi);
    }
  }
  
  atts.push({
    type: cat,
    fileUrl: null,
    filePath: fp,
    filename: path.basename(fp),
    mimeType: mime,
    size: null, width: null, height: null, duration: null,
    caption: null  // No caption individual
  });
}

r(msg, mainCaption, atts);
  
  if (err) {
    const em = err.stderr || err.message || '';
    const um = await updt();
    if (um) l(um);
  }
}

async function search(msg, q, vid = false) {
  const sid = `dla_${Date.now()}`;
  const od = path.join(C.M, sid);
  const ck = bCook();
  
  await fs.mkdir(od, { recursive: true });
  
  const ot = path.join(od, '%(title).70s.%(ext)s');
  const fa = vid ? C.F.video : C.F.audio;
  
  const srcs = [
    { s: 'ytsearch', n: 'YouTube' },
    ...(vid ? [] : [{ s: 'scsearch', n: 'SoundCloud' }])
  ];
  
  r(msg, `🔍 ${q}`);
  
  for (const { s, n } of srcs) {
    l(`Buscando ${n}...`);
    
    const su = `${s}10:${q}`;
    const args = ['--max-filesize', C.S.toString(), ...C.A, '--playlist-items', '1', ...fa, ...ck, '-o', ot, su];
    
    try {
      await exec(args);
    } catch (e) {
      l(`Error ${n}: ${e.message}`);
    }
    
    const af = await fs.readdir(od);
    const fls = af.filter(x => !x.endsWith('.info.json'));
    
    if (fls.length > 0) {
      const atts = [];
      
      for (const f of fls) {
        const fp = await fixExt(path.join(od, f));
        const cat = getCat(fp);
        const mime = getMime(fp);
        
        atts.push({
          type: cat,
          fileUrl: null,
          filePath: fp,
          filename: path.basename(fp),
          mimeType: mime,
          size: null, width: null, height: null, duration: null,
          caption: null
        });
      }
      
      r(msg, `✅ ${n}`, atts);
      return;
    }
  }
  
  await clean(od);
  r(msg, `❌ No encontrado: ${q}`);
}

async function upCook(msg, txt = null) {
  const qm = msg.message?.replyTo;
  let cc = null;
  
  if (txt) {
    cc = txt;
  } else if (qm && qm.attachments && qm.attachments.length > 0) {
    const att = qm.attachments[0];
    if (att.filePath && require('fs').existsSync(att.filePath)) {
      cc = await fs.readFile(att.filePath, 'utf8');
    } else {
      r(msg, '❌ Archivo no encontrado');
      return;
    }
  } else {
    r(msg, '❌ Cita archivo o texto');
    return;
  }
  
  await ensDir();
  await fs.writeFile(C.K, cc);
  r(msg, '✅ Cookies subidas');
}

parentPort.on('message', async (data) => {
  try {
    const { message, args } = data;
    await ensDir();
    
    const inp = args.trim();
    
    if (!inp) {
      r(message, `🎵 .dla <búsqueda>
🎥 .dla vd <búsqueda>
⬇️ .dla <url>
✂️ .dla <url> --t 1:30-2:45
🎵 .dla mp3 <url>
🍪 .dla cookies <texto>
Límite: ${C.S / 1048576}MB`);
      return;
    }
    
    if (inp.toLowerCase().startsWith('cookies')) {
      const ct = inp.substring('cookies'.length).trim();
      await upCook(message, ct || null);
      return;
    }
    
    const ur = /(https?:\/\/[^\s]+)/g;
    const us = (inp.match(ur) || []).filter(u => isUrl(u));
    
    if (us.length > 0) {
      let cp = inp;
      us.forEach(u => { cp = cp.replace(u, '').trim(); });
      
      const pts = cp.split(/\s+/).filter(p => p);
      const fp = pts[0] || '';
      
      if (fp === 'mp3') {
        await dlMedia(message, us, 'audio', true, null);
      } else {
        let tr = null;
        const ti = pts.indexOf('--t');
        if (ti !== -1 && pts[ti + 1]) {
          const ts = pts.slice(ti + 1).join(' ');
          tr = pTime(ts);
        }
        await dlMedia(message, us, 'video', false, tr);
      }
      return;
    }
    
    const ap = inp.trim().split(/\s+/);
    const cmd = ap[0];
    const ra = ap.slice(1);
    
    if (cmd === 'vd') {
      await search(message, ra.join(' '), true);
    } else {
      await search(message, inp, false);
    }
  } catch (error) {
    parentPort.postMessage({ type: 'error', message: `Error: ${error.message}` });
    r(data.message, `❌ ${error.message}`);
  }
});