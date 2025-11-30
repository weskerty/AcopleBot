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
    desc: 'Descarga videos y audios de múltiples plataformas',
    type: 'utilidad',
    deps: ['']
});

const CONFIG = {
    DATA_DIR: path.join(__dirname, '..', '..', 'Extras', 'DatosPlugins', 'DLA'),
    MEDIA_DIR: path.join(__dirname, '..', 'media'),
    COOKIES_PATH: path.join(__dirname, '..', '..', 'Extras', 'DatosPlugins', 'DLA', 'cookies.txt'),
    MAX_FILESIZE: parseInt(process.env.MEDIA_FILE_MAX || '500') * 1048576,
    YT_DLP_BINARIES: new Map([
        ['win32-x64', 'yt-dlp.exe'],
        ['win32-ia32', 'yt-dlp_x86.exe'],
        ['darwin', 'yt-dlp_macos'],
        ['linux-x64', 'yt-dlp_linux'],
        ['linux-arm64', 'yt-dlp_linux_aarch64'],
        ['linux-arm', 'yt-dlp_linux_armv7l'],
        ['default', 'yt-dlp']
    ])
};

const PRESET_FORMATS = {
    video: ['-f', 'sd/18/bestvideo[height<=720][vcodec*=h264]+bestaudio[acodec*=aac]/bestvideo[height<=720][vcodec*=h264]+bestaudio[acodec*=mp4a]/bestvideo[height<=720][vcodec*=h264]+bestaudio/bestvideo[height<=720]+bestaudio/bestvideo[vcodec*=h264]+bestaudio[acodec*=aac]/bestvideo[vcodec*=h264]+bestaudio[acodec*=mp4a]/bestvideo[vcodec*=h264]+bestaudio/bestvideo+bestaudio/best', '--sponsorblock-remove', 'all', '--embed-chapters', '--embed-metadata'],
    audio: ['-f', 'ba/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-metadata', '--convert-thumbnails', 'jpg', '--postprocessor-args', 'ffmpeg:-id3v2_version 3', '--sponsorblock-remove', 'all']
};

const COMMON_ARGS = [
    '--restrict-filenames',
    '--extractor-retries', '3',
    '--fragment-retries', '3',
    '--compat-options', 'no-youtube-unavailable-videos',
    '--ignore-errors',
    '--no-abort-on-error'
];

let ytDlpBinaryPath = null;

function log(message) {
    parentPort.postMessage({
        type: 'log',
        message: message
    });
}

function respond(originalMessage, text, attachments = null) {
    parentPort.postMessage({
        type: 'response',
        originalMessage: originalMessage,
        response: {
            text: text,
            attachments: attachments
        }
    });
}

async function ensureDirectories() {
    await fs.mkdir(CONFIG.DATA_DIR, { recursive: true });
    await fs.mkdir(CONFIG.MEDIA_DIR, { recursive: true });
}

async function isYtDlpAvailable() {
    try {
        await execFileAsync('yt-dlp', ['--version']);
        return true;
    } catch {
        return false;
    }
}

function detectYtDlpBinaryName() {
    const platform = os.platform();
    const arch = os.arch();
    const key = `${platform}-${arch}`;
    return CONFIG.YT_DLP_BINARIES.get(key) || CONFIG.YT_DLP_BINARIES.get('default');
}

async function downloadYtDlpBinary() {
    const fileName = detectYtDlpBinaryName();
    const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${fileName}`;
    const filePath = path.join(CONFIG.DATA_DIR, fileName);

    log('⬇️ Descargando yt-dlp...');

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    if (os.platform() !== 'win32') {
        await fs.chmod(filePath, '755');
    }

    log('✅ yt-dlp descargado correctamente');

    return filePath;
}

async function detectYtDlpBinary() {
    if (ytDlpBinaryPath) {
        return ytDlpBinaryPath;
    }

    if (await isYtDlpAvailable()) {
        ytDlpBinaryPath = 'yt-dlp';
        return ytDlpBinaryPath;
    }

    const fileName = detectYtDlpBinaryName();
    const filePath = path.join(CONFIG.DATA_DIR, fileName);
    
    try {
        await fs.access(filePath);
        ytDlpBinaryPath = filePath;
        return ytDlpBinaryPath;
    } catch {
        ytDlpBinaryPath = await downloadYtDlpBinary();
        return ytDlpBinaryPath;
    }
}

function buildCookiesArgs() {
    try {
        require('fs').accessSync(CONFIG.COOKIES_PATH, require('fs').constants.F_OK);
        return ['--cookies', CONFIG.COOKIES_PATH];
    } catch {
        return [];
    }
}

function normalizeTimeSegment(segment) {
    const parts = segment.split(':');
    
    if (parts.length === 2) {
        const [min, sec] = parts;
        return `00:${min.padStart(2, '0')}:${sec.padStart(2, '0')}`;
    } else if (parts.length === 3) {
        const [h, m, s] = parts;
        return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
    }
    
    return segment;
}

function parseTimeRanges(timeString) {
    if (!timeString || !timeString.trim()) {
        return null;
    }

    const ranges = timeString.split(/\s+|,/).filter(r => r.trim());
    const normalizedRanges = [];

    for (const range of ranges) {
        if (range.includes('-')) {
            const [start, end] = range.split('-');
            const normalizedStart = normalizeTimeSegment(start.trim());
            const normalizedEnd = normalizeTimeSegment(end.trim());
            normalizedRanges.push(`*${normalizedStart}-${normalizedEnd}`);
        }
    }

    return normalizedRanges.length > 0 ? normalizedRanges.join(',') : null;
}

function getFileCategory(filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    
    const videoExts = ['mp4', 'mkv', 'avi', 'webm', 'mov', 'flv', 'm4v'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (imageExts.includes(ext)) return 'image';
    return 'document';
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeTypes = {
        'mp4': 'video/mp4',
        'mkv': 'video/x-matroska',
        'webm': 'video/webm',
        'mp3': 'audio/mpeg',
        'ogg': 'audio/ogg',
        'm4a': 'audio/mp4',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

async function safeExecuteYtDlp(args) {
    const ytDlpPath = await detectYtDlpBinary();
    return await execFileAsync(ytDlpPath, args, {
        maxBuffer: 1024 * 1024 * 10,
        timeout: 600000
    });
}

function isUrl(str) {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

async function downloadMedia(message, urls, formatType = 'video', enablePlaylist = false, timeRanges = null) {
    const sessionId = `dla_${Date.now()}`;
    const outputDir = path.join(CONFIG.MEDIA_DIR, sessionId);
    const cookiesArgs = buildCookiesArgs();

    await fs.mkdir(outputDir, { recursive: true });

    respond(message, '⏳ Descargando...');

    for (const url of urls) {
        const outputTemplate = path.join(outputDir, '%(title).70s.%(ext)s');
        const playlistArgs = enablePlaylist ? ['--yes-playlist', '--playlist-items', '1:20'] : ['--no-playlist'];
        const timeRangeArgs = timeRanges && !enablePlaylist ? ['--download-sections', timeRanges] : [];
        
        const args = [
            '--max-filesize', CONFIG.MAX_FILESIZE.toString(),
            ...COMMON_ARGS,
            ...playlistArgs,
            ...cookiesArgs,
            ...timeRangeArgs,
            ...PRESET_FORMATS[formatType],
            '-o', outputTemplate,
            url
        ];

        try {
            await safeExecuteYtDlp(args);
        } catch (error) {
            log(`Error descargando ${url}: ${error.message}`);
        }
    }

    const allFiles = await fs.readdir(outputDir);
    const files = allFiles.filter(f => !f.endsWith('.info.json') && !f.endsWith('.jpg') && !f.endsWith('.webp'));
    
    if (files.length === 0) {
        await fs.rm(outputDir, { recursive: true, force: true });
        respond(message, '❌ No se descargaron archivos. El archivo puede ser muy grande o la URL es inválida.');
        return;
    }

    const attachments = [];

    for (const file of files) {
        const filePath = path.join(outputDir, file);
        const category = getFileCategory(filePath);
        const mimeType = getMimeType(filePath);

        attachments.push({
            type: category,
            fileUrl: null,
            filePath: filePath,
            filename: file,
            mimeType: mimeType,
            size: null,
            width: null,
            height: null,
            duration: null,
            caption: null
        });
    }

    respond(message, `✅ ${files.length} archivo(s) descargado(s)`, attachments);

}

async function searchAndDownload(message, searchQuery, isVideo = false) {
    const sessionId = `dla_${Date.now()}`;
    const outputDir = path.join(CONFIG.MEDIA_DIR, sessionId);
    const cookiesArgs = buildCookiesArgs();
    
    await fs.mkdir(outputDir, { recursive: true });

    const outputTemplate = path.join(outputDir, '%(title).70s.%(ext)s');
    
    const formatArgs = isVideo ? PRESET_FORMATS.video : PRESET_FORMATS.audio;
    
    const searchSources = [
        { source: 'ytsearch', name: 'YouTube' },
        ...(isVideo ? [] : [
            { source: 'scsearch', name: 'SoundCloud' }
        ])
    ];

    let success = false;

    respond(message, `🔍 Buscando: ${searchQuery}`);

    for (const { source, name } of searchSources) {
        if (success) break;

        log(`Buscando en ${name}...`);

        const searchUrl = `${source}10:${searchQuery}`;
        const args = [
            '--max-filesize', CONFIG.MAX_FILESIZE.toString(),
            ...COMMON_ARGS,
            '--playlist-items', '1',
            ...formatArgs,
            ...cookiesArgs,
            '-o', outputTemplate,
            searchUrl
        ];

        try {
            await safeExecuteYtDlp(args);
        } catch (error) {
            log(`Error buscando en ${name}: ${error.message}`);
        }

        const allFiles = await fs.readdir(outputDir);
        const files = allFiles.filter(f => !f.endsWith('.info.json') && !f.endsWith('.jpg') && !f.endsWith('.webp'));
        
        if (files.length > 0) {
            const attachments = [];

            for (const file of files) {
                const filePath = path.join(outputDir, file);
                const category = getFileCategory(filePath);
                const mimeType = getMimeType(filePath);

                attachments.push({
                    type: category,
                    fileUrl: null,
                    filePath: filePath,
                    filename: file,
                    mimeType: mimeType,
                    size: null,
                    width: null,
                    height: null,
                    duration: null,
                    caption: null
                });
            }

            respond(message, `✅ Encontrado en ${name}`, attachments);


            success = true;
            break;
        }
    }

    if (!success) {
        await fs.rm(outputDir, { recursive: true, force: true });
        respond(message, `❌ No se encontró: ${searchQuery}`);
    }
}

parentPort.on('message', async (data) => {
    try {
        const { message, args } = data;
        
        await ensureDirectories();
        
        const input = args.trim();
        
        if (!input) {
            respond(message, `🎵 Uso del comando:

.dla <búsqueda> - Buscar canción
.dla vd <búsqueda> - Buscar video
.dla <url> - Descargar de URL
.dla mp3 <url> - Playlist como MP3
.dla <url> --t 1:30-2:45 - Segmento

Límite: ${CONFIG.MAX_FILESIZE / 1048576}MB`);
            return;
        }

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = (input.match(urlRegex) || []).filter(url => isUrl(url));

        if (urls.length > 0) {
            let commandPart = input;
            urls.forEach(url => {
                commandPart = commandPart.replace(url, '').trim();
            });
            
            const parts = commandPart.split(/\s+/).filter(p => p);
            const firstPart = parts[0] || '';
            
            if (firstPart === 'mp3') {
                await downloadMedia(message, urls, 'audio', true, null);
            } else {
                let timeRanges = null;
                const timeIndex = parts.indexOf('--t');
                if (timeIndex !== -1 && parts[timeIndex + 1]) {
                    const timeString = parts.slice(timeIndex + 1).join(' ');
                    timeRanges = parseTimeRanges(timeString);
                }
                await downloadMedia(message, urls, 'video', false, timeRanges);
            }
            return;
        }

        const argsParts = input.trim().split(/\s+/);
        const command = argsParts[0];
        const remainingArgs = argsParts.slice(1);
        
        if (command === 'vd') {
            await searchAndDownload(message, remainingArgs.join(' '), true);
        } else {
            await searchAndDownload(message, input, false);
        }
        
    } catch (error) {
        parentPort.postMessage({
            type: 'error',
            message: `Error: ${error.message}`
        });
        
        respond(data.message, `❌ Error: ${error.message}`);
    }
});