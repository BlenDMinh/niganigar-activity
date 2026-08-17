import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';

export interface ResolvedAudio {
  stream: Readable;
  mimeType: string;
  durationSeconds: number | null;
  estimatedBytes: number | null;
  // Resolves once the yt-dlp process exits. A failed download still ends
  // its stdout "cleanly" (the pipe just closes with 0 bytes) — Node
  // fires that 'end' *before* the process 'close' event, so anything
  // piping from `stream` sees a normal finish before we'd ever get a
  // chance to signal the error on the stream itself. Callers must await
  // this and check for a non-zero code before trusting a finished pipe
  // as a real success.
  exitCode: Promise<number | null>;
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
// authenticated browser session work around it. The cookies file is
// expected to be bind-mounted into the container at this path (see
// docker-compose.yml) rather than passed as an env var — a real cookies
// file is easily large enough to blow past the OS's combined
// argument+environment size limit (exec fails with "argument list too
// long"), so a file mount is the only robust option here.
const COOKIES_PATH = join(process.cwd(), 'yt-dlp-cookies.txt');

// YouTube protects real stream URLs behind an obfuscated-JS signature/"n
// challenge" that yt-dlp must execute to decipher. Having a JS runtime
// (deno, installed in the image) isn't enough on its own — yt-dlp also
// needs the actual solver script, and won't auto-download that without
// this flag (by design, since it means fetching and running remote code).
// Confirmed via direct testing: without this, every video silently falls
// back to storyboard-only "formats" with no visible error.
const REMOTE_COMPONENTS_ARGS = ['--remote-components', 'ejs:github'];

// Cap quality instead of always grabbing the highest-bitrate audio-only
// stream (~130kbps opus/m4a on most videos) — this is background music,
// not something anyone's critically listening to, and every listener
// fetches the full file fresh (no partial/streaming benefit, since it's
// pulled via fetch() -> blob: for the CSP fix). ~96kbps is still solid for
// this use case at roughly half the bandwidth/storage per song. Falls
// back to any audio-only stream, then any stream at all, if nothing in
// range is offered.
const FORMAT_SELECTOR = 'bestaudio[abr<=96]/bestaudio/best';

// YouTube's own extraction behavior varies request-to-request for the
// same video (different internal player client picked each time, with
// different PO-token/SABR handling) — a request that fails with "Sign in
// to confirm you're not a bot" often just succeeds on the next attempt.
// Retrying the (cheap, --skip-download) probe step catches this before
// ever starting a real download.
const MAX_PROBE_ATTEMPTS = 3;

// youtubei.js (pure npm) can no longer fetch playable stream URLs for most
// videos without solving YouTube's PO-token anti-bot challenge, which in
// practice requires a headless browser. yt-dlp ships its own actively
// maintained PO-token handling, so we shell out to it instead — see
// server/Dockerfile for the binary install.
@Injectable()
export class YoutubeAudioService implements OnModuleInit {
  private readonly logger = new Logger(YoutubeAudioService.name);

  onModuleInit() {
    this.logger.log(
      existsSync(COOKIES_PATH)
        ? `yt-dlp cookies file found at ${COOKIES_PATH}`
        : "no yt-dlp cookies file mounted — requests may hit YouTube's bot check",
    );
  }

  private cookieArgs(): string[] {
    return existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];
  }

  async fetchAudio(videoId: string): Promise<ResolvedAudio> {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const { durationSeconds, ext, estimatedBytes } = await this.probeWithRetry(
      url,
      videoId,
    );
    const mimeType = MIME_BY_EXT[ext] ?? 'audio/webm';

    const child = spawn(
      'yt-dlp',
      [
        '-f',
        FORMAT_SELECTOR,
        '--no-playlist',
        '--no-warnings',
        ...REMOTE_COMPONENTS_ARGS,
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
    const exitCode = new Promise<number | null>((resolveCode) => {
      child.on('close', (code) => {
        if (code !== 0) {
          this.logger.error(
            `yt-dlp exited ${code} for ${videoId}: ${stderr.slice(0, 500)}`,
          );
        }
        resolveCode(code);
      });
    });

    if (!child.stdout) {
      throw new Error(`yt-dlp produced no stdout stream for ${videoId}`);
    }

    return {
      stream: child.stdout,
      mimeType,
      durationSeconds,
      estimatedBytes,
      exitCode,
    };
  }

  private async probeWithRetry(
    url: string,
    videoId: string,
  ): Promise<{
    durationSeconds: number | null;
    ext: string;
    estimatedBytes: number | null;
  }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_PROBE_ATTEMPTS; attempt++) {
      try {
        return await this.probe(url);
      } catch (e) {
        lastError = e;
        this.logger.warn(
          `probe attempt ${attempt}/${MAX_PROBE_ATTEMPTS} failed for ${videoId}: ${(e as Error).message.slice(0, 200)}`,
        );
      }
    }
    void this.logAvailableFormats(url);
    throw lastError;
  }

  private probe(url: string): Promise<{
    durationSeconds: number | null;
    ext: string;
    estimatedBytes: number | null;
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn('yt-dlp', [
        '-f',
        FORMAT_SELECTOR,
        '--no-playlist',
        '--skip-download',
        '--no-warnings',
        ...REMOTE_COMPONENTS_ARGS,
        ...this.cookieArgs(),
        '--print',
        '%(duration)s\t%(ext)s\t%(filesize,filesize_approx)s',
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
        const [durationRaw, ext, sizeRaw] = stdout.trim().split('\t');
        const duration = Number(durationRaw);
        const size = Number(sizeRaw);
        resolve({
          durationSeconds: Number.isFinite(duration) ? duration : null,
          ext: ext || 'webm',
          estimatedBytes: Number.isFinite(size) && size > 0 ? size : null,
        });
      });
    });
  }

  // Fire-and-forget diagnostic dump for when format selection fails — logs
  // what yt-dlp actually sees (from this exact machine, with these exact
  // cookies) instead of leaving us guessing from a different environment.
  private logAvailableFormats(url: string): Promise<void> {
    return new Promise((resolveDone) => {
      const child = spawn('yt-dlp', [
        '--list-formats',
        '--no-warnings',
        ...REMOTE_COMPONENTS_ARGS,
        ...this.cookieArgs(),
        url,
      ]);
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.on('close', () => {
        this.logger.error(
          `Available formats for ${url}:\n${out.slice(0, 3000)}`,
        );
        resolveDone();
      });
      child.on('error', () => resolveDone());
    });
  }
}
