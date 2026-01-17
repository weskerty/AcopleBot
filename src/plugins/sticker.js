import { parentPort } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execAsync = promisify(exec);

const ABMetaInfo = () => {};

ABMetaInfo({
    pattern: 's',
    url: '',
    sudo: false,
    desc: 'Convierte imagen/video a sticker (responde a multimedia)',
           type: 'utilidad',
           deps: []
});

const MEDIA_FOLDER = process.env.MEDIA_FOLDER || path.join(process.cwd(), 'src', 'media');
const MAX_SIZE = 1024 * 1024;
const STICKER_SIZE = 512;

const getTempPath = (ext) => {
    return path.join(MEDIA_FOLDER, `sticker_${crypto.randomUUID().substring(0, 8)}.${ext}`);
};

const getFileSize = async (filePath) => {
    const stats = await fs.promises.stat(filePath);
    return stats.size;
};

const convertImageToWebP = async (inputPath, outputPath) => {
    let quality = 90;
    let attempt = 0;
    const maxAttempts = 5;

    while (attempt < maxAttempts) {
        const cmd = `ffmpeg -i "${inputPath}" -vf "scale='min(${STICKER_SIZE},iw)':'min(${STICKER_SIZE},ih)':force_original_aspect_ratio=decrease,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=white@0.0,format=rgba" -c:v libwebp -quality ${quality} -compression_level 6 -y "${outputPath}"`;

        await execAsync(cmd);

        const size = await getFileSize(outputPath);

        if (size <= MAX_SIZE) {
            return outputPath;
        }

        quality -= 15;
        attempt++;
    }

    throw new Error('No se pudo comprimir la imagen a menos de 1MB');
};

const convertVideoToWebM = async (inputPath, outputPath) => {
    let crf = 30;
    let attempt = 0;
    const maxAttempts = 8;

    while (attempt < maxAttempts) {
        const cmd = `ffmpeg -i "${inputPath}" -t 3 -vf "scale='min(${STICKER_SIZE},iw)':'min(${STICKER_SIZE},ih)':force_original_aspect_ratio=decrease,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=black,fps=15" -c:v libvpx-vp9 -crf ${crf} -b:v 0 -pix_fmt yuva420p -an -auto-alt-ref 0 -y "${outputPath}"`;

        await execAsync(cmd);

        const size = await getFileSize(outputPath);

        if (size <= MAX_SIZE) {
            return outputPath;
        }

        crf += 5;
        attempt++;
    }

    throw new Error('No se pudo comprimir el video a menos de 1MB');
};

const checkFFmpeg = async () => {
    try {
        await execAsync('ffmpeg -version');
        return true;
    } catch (error) {
        return false;
    }
};

parentPort.on('message', async (data) => {
    let tempOutput = null;

    try {
        const { message, fullContext } = data;

        const hasFFmpeg = await checkFFmpeg();
        if (!hasFFmpeg) {
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ FFmpeg no está instalado\nInstala: sudo apt install ffmpeg'
                }
            });
        }

        let targetMessage = null;

        if (message.message?.replyTo && fullContext?.message?.replyTo) {
            targetMessage = fullContext.message.replyTo;
        } else {
            targetMessage = message;
        }

        if (!targetMessage.attachments || targetMessage.attachments.length === 0) {
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ Responde a una imagen o video con .s'
                }
            });
        }

        const attachment = targetMessage.attachments[0];

        if (!attachment.filePath || !fs.existsSync(attachment.filePath)) {
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ Archivo multimedia no encontrado'
                }
            });
        }

        const inputPath = attachment.filePath;
        const isImage = ['image', 'sticker'].includes(attachment.type);
        const isVideo = ['video', 'gif', 'video_note'].includes(attachment.type);

        if (!isImage && !isVideo) {
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ Solo se aceptan imágenes o videos'
                }
            });
        }

        parentPort.postMessage({
            type: 'log',
            message: `Procesando ${isImage ? 'imagen' : 'video'} para sticker`
        });

        let outputPath;

        if (isImage) {
            tempOutput = getTempPath('webp');
            outputPath = await convertImageToWebP(inputPath, tempOutput);
        } else {
            tempOutput = getTempPath('webm');
            outputPath = await convertVideoToWebM(inputPath, tempOutput);
        }

        const finalSize = await getFileSize(outputPath);
        const sizeKB = (finalSize / 1024).toFixed(2);

        parentPort.postMessage({
            type: 'response',
            originalMessage: message,
            response: {
                attachments: [{
                    type: 'sticker',
                    filePath: outputPath,
                    filename: path.basename(outputPath),
                               mimeType: isImage ? 'image/webp' : 'video/webm',
                               size: finalSize
                }]
            }
        });

        setTimeout(() => {
            try {
                if (tempOutput && fs.existsSync(tempOutput)) {
                    fs.unlinkSync(tempOutput);
                }
            } catch (e) {
                // Ignorar errores de limpieza
            }
        }, 60000);

    } catch (error) {
        if (tempOutput && fs.existsSync(tempOutput)) {
            try {
                fs.unlinkSync(tempOutput);
            } catch (e) {
                // Ignorar errores de limpieza
            }
        }

        parentPort.postMessage({
            type: 'error',
            message: `Error: ${error.message}`
        });

        parentPort.postMessage({
            type: 'response',
            originalMessage: data.message,
            response: {
                text: `❌ ${error.message}`
            }
        });
    }
});
