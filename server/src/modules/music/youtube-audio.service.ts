import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';

export interface ResolvedAudio {
  stream: Readable;
  mimeType: string;
  durationSeconds: number | null;
}

const MIME_BY_EXT: Record<string, string> = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
};

// Cloud-provider IP ranges (AWS/GCP/etc.) routinely get YouTube's "Sign in
// to confirm you're not a bot" anti-bot block. Cookies from an
// authenticated browser session work around it — see README/deploy notes
// for how YTDLP_COOKIES_B64 is populated. Written to disk at startup
// rather than baked into the image, so the secret never lands in a layer.
const COOKIES_PATH = join(process.cwd(), 'yt-dlp-cookies.txt');

// youtubei.js (pure npm) can no longer fetch playable stream URLs for most
// videos without solving YouTube's PO-token anti-bot challenge, which in
// practice requires a headless browser. yt-dlp ships its own actively
// maintained PO-token handling, so we shell out to it instead — see
// server/Dockerfile for the binary install.
@Injectable()
export class YoutubeAudioService implements OnModuleInit {
  private readonly logger = new Logger(YoutubeAudioService.name);

  async onModuleInit() {
    const cookiesB64 = process.env.YTDLP_COOKIES_B64;
    if (!cookiesB64) return;
    await writeFile(COOKIES_PATH, Buffer.from(cookiesB64, 'base64'), {
      mode: 0o600,
    });
    this.logger.log('yt-dlp cookies file written');
  }

  private cookieArgs(): string[] {
    return existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];
  }

  async fetchAudio(videoId: string): Promise<ResolvedAudio> {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const { durationSeconds, ext } = await this.probe(url);
    const mimeType = MIME_BY_EXT[ext] ?? 'audio/webm';

    const child = spawn(
      'yt-dlp',
      [
        '-f',
        'bestaudio',
        '--no-playlist',
        '--no-warnings',
        ...this.cookieArgs(),
        '-o',
        '-',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        this.logger.error(
          `yt-dlp exited ${code} for ${videoId}: ${stderr.slice(0, 500)}`,
        );
      }
    });

    if (!child.stdout) {
      throw new Error(`yt-dlp produced no stdout stream for ${videoId}`);
    }

    return { stream: child.stdout, mimeType, durationSeconds };
  }

  private probe(
    url: string,
  ): Promise<{ durationSeconds: number | null; ext: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('yt-dlp', [
        '-f',
        'bestaudio',
        '--no-playlist',
        '--skip-download',
        '--no-warnings',
        ...this.cookieArgs(),
        '--print',
        '%(duration)s\t%(ext)s',
        url,
      ]);

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(`yt-dlp probe failed (${code}): ${stderr.slice(0, 500)}`),
          );
          return;
        }
        const [durationRaw, ext] = stdout.trim().split('\t');
        const duration = Number(durationRaw);
        resolve({
          durationSeconds: Number.isFinite(duration) ? duration : null,
          ext: ext || 'webm',
        });
      });
    });
  }
}
